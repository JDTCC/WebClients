import { ReactNode, useEffect, useRef } from 'react';

import { CryptoProxy, VERIFICATION_STATUS, serverTime } from '@proton/crypto';
import {
    EXP_EPOCH_INTERVAL,
    KTBlobContent,
    KT_STATUS,
    auditAddresses,
    commitOthersKeystoLS,
    getAuditResult,
    getKTLocalStorage,
    ktSentryReport,
    verifyPublicKeys,
} from '@proton/key-transparency';
import { APP_NAMES } from '@proton/shared/lib/constants';
import { stringToUint8Array, uint8ArrayToBase64String } from '@proton/shared/lib/helpers/encoding';
import { KeyTransparencyState, VerifyOutboundPublicKeys } from '@proton/shared/lib/interfaces';

import { useApi, useFeature, useGetAddresses, useGetUserKeys, useUser } from '../../hooks';
import { FeatureCode } from '../features';
import { KTContext } from './ktContext';
import { KT_FF, isKTActive, removeKTBlobs } from './ktStatus';
import { KeyTransparencyContext } from './useKeyTransparencyContext';

/**
 * Generate a unique fake ID from an email address
 */
const generateID = async (userID: string, email: string) => {
    const digest = await CryptoProxy.computeHash({
        algorithm: 'SHA256',
        data: stringToUint8Array(`${userID}${email}`),
    });
    return uint8ArrayToBase64String(digest.slice(0, 64)).replace(/\+/g, '-').replace(/\//g, '_');
};

interface Props {
    children: ReactNode;
    APP_NAME: APP_NAMES;
}

const KeyTransparencyManager = ({ children, APP_NAME }: Props) => {
    const getAddresses = useGetAddresses();
    const getUserKeys = useGetUserKeys();
    const [{ ID: userID }] = useUser();
    const normalApi = useApi();
    const silentApi = <T,>(config: any) => normalApi<T>({ ...config, silence: true });
    const { get } = useFeature<KT_FF | undefined>(FeatureCode.KeyTransparencyWEB);
    const ktLSAPI = getKTLocalStorage(APP_NAME);

    const ktState = useRef<KeyTransparencyState>({
        selfAuditPromise: Promise.resolve(),
        ktLSAPI,
    });

    /**
     * Returns the current state of the Key Transparency manager
     */
    const getKTState = () => ktState;

    /**
     * In case some public keys used to send messages are not yet in
     * Key Transparency, we postpone verification to a later time
     */
    const verifyOutboundPublicKeys: VerifyOutboundPublicKeys = async (keyList, email, SignedKeyList, IgnoreKT) => {
        const ktStatus = await verifyPublicKeys(keyList, email, SignedKeyList, normalApi, IgnoreKT);

        if (SignedKeyList) {
            // In case the keys are not in KT yet, we stash them for later verification
            if (ktStatus === KT_STATUS.KT_MINEPOCHID_NULL) {
                const { Data, Signature, ExpectedMinEpochID } = SignedKeyList;

                // Since MinEpochID is null, ExpectedMinEpochID must be returned
                if (!ExpectedMinEpochID) {
                    ktSentryReport('ExpectedMinEpochID set to null for a SKL with MinEpochID set to null', {
                        context: 'verifyOutboundPublicKeys',
                    });
                    return;
                }

                // The fake address is generated just for matching purposes inside the stashedKeys
                // structure and to avoid wiriting the email in plaintext in localStorage
                const fakeAddressID = await generateID(userID, email);

                const isActive = Data !== null && Signature !== null;
                const PublicKeys = keyList.map(({ PublicKey }) => PublicKey);
                const ktBlobContent: KTBlobContent = {
                    PublicKeys,
                    ExpectedMinEpochID,
                    creationTimestamp: +serverTime(),
                    email,
                    isObsolete: !isActive,
                };

                // NOTE: signatureTimestamp is needed to store creationTimestamp, however in case
                // Data and Signature don't exist, i.e. we're dealing with an obsolescent SKL,
                // creationTimestamp should be extracted directly from the ObsolescenceToken
                if (isActive) {
                    const verificationKeys = await Promise.all(
                        PublicKeys.map((armoredKey) => CryptoProxy.importPublicKey({ armoredKey }))
                    );
                    const { verified, signatureTimestamp, errors } = await CryptoProxy.verifyMessage({
                        textData: Data,
                        armoredSignature: Signature,
                        verificationKeys,
                    });

                    if (verified !== VERIFICATION_STATUS.SIGNED_AND_VALID || !signatureTimestamp) {
                        ktSentryReport('Submitted SKL signature verification failed', {
                            context: 'verifyOutboundPublicKeys',
                            errors: JSON.stringify(errors),
                        });
                        return;
                    }

                    ktBlobContent.creationTimestamp = signatureTimestamp.getTime();
                }

                const userKeys = await getUserKeys();
                await commitOthersKeystoLS(
                    ktBlobContent,
                    userKeys.map(({ privateKey }) => privateKey),
                    ktState.current.ktLSAPI,
                    userID,
                    fakeAddressID
                ).catch((error: any) => {
                    ktSentryReport('Failure during others keys commitment', {
                        context: 'verifyOutboundPublicKeys',
                        errorMessage: error.message,
                    });
                });
            }
        }
    };

    useEffect(() => {
        const run = async () => {
            const feature = await get().then((result) => result?.Value);
            const addressesPromise = getAddresses();

            // Since we cannot check the feature flag at login time, the
            // createPreAuthKTVerifier helper might have created blobs
            // in local storage. If this is the case and the feature flag
            // turns out to be disabled, we remove them all
            if (feature === KT_FF.DISABLE) {
                const addresses = await addressesPromise;
                await removeKTBlobs(
                    userID,
                    addresses.map(({ ID }) => ID),
                    ktLSAPI
                );
            }

            if (!(await isKTActive(feature))) {
                return;
            }

            const userKeys = await getUserKeys();
            const lastSelfAudit = await getAuditResult(userID, ktLSAPI);

            const elapsedTime = +serverTime() - (lastSelfAudit || 0);
            let timer = EXP_EPOCH_INTERVAL;
            if (elapsedTime > EXP_EPOCH_INTERVAL) {
                const addresses = await addressesPromise;
                const selfAuditPromise = auditAddresses(userID, [normalApi, silentApi], addresses, userKeys, ktLSAPI);

                selfAuditPromise.catch((e) => console.log({ e, stack: e.stack }));

                // Run ends
                ktState.current = {
                    selfAuditPromise,
                    ktLSAPI,
                };
            } else {
                timer = elapsedTime;
            }

            // Repeat every expectedEpochInterval (4h)
            setTimeout(() => {
                void run();
            }, timer);
        };

        void run();
    }, []);

    const ktFunctions: KTContext = {
        getKTState,
        verifyOutboundPublicKeys,
    };

    return <KeyTransparencyContext.Provider value={ktFunctions}>{children}</KeyTransparencyContext.Provider>;
};

export default KeyTransparencyManager;
