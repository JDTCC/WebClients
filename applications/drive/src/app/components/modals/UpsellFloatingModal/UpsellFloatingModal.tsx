import { MouseEvent as ReactMouseEvent, useLayoutEffect, useRef, useState } from 'react';

import { c } from 'ttag';

import { Button, ButtonLike } from '@proton/atoms/Button';
import { Icon, ModalTwo, ModalTwoFooter, Tooltip } from '@proton/components/components';
import Dialog from '@proton/components/components/dialog/Dialog';
import { Portal } from '@proton/components/components/portal';
import { useActiveBreakpoint } from '@proton/components/hooks';
import usePrevious from '@proton/hooks/usePrevious';
import { modalTwoRootClassName } from '@proton/shared/lib/busy';
import { DRIVE_APP_NAME } from '@proton/shared/lib/constants';
import bigLogoWhite from '@proton/styles/assets/img/drive/big-logo-white.svg';
import clsx from '@proton/utils/clsx';

import { DRIVE_PRICING_PAGE } from '../../../constants/urls';

import './UpsellFloatingModal.scss';

interface ChildProps {
    open: boolean;
    onClose: () => void;
    onBlockNewOpening: () => void;
}

const UpsellFloatingModalContent = ({ onClose }: Pick<ChildProps, 'onClose'>) => {
    return (
        <>
            <div className="upsell-floating-modal-content w100 flex flex-justify-center p5">
                <Tooltip className="upsell-floating-modal-tooltip" title={c('Action').t`Close`} onClick={onClose}>
                    <Button className="flex-item-noshrink" icon shape="ghost" data-testid="modal:close">
                        <Icon className="modal-close-icon" name="cross-big" alt={c('Action').t`Close`} />
                    </Button>
                </Tooltip>
                <img className="block" src={bigLogoWhite} alt={DRIVE_APP_NAME} />
            </div>
            <div className="m1 ml1-5 mr1-5">
                <span className="upsell-floating-modal-badge text-semibold rounded pt0-25 pb0-25 pl1 pr1 mt0-5">{c(
                    'Info'
                ).t`Free forever`}</span>
                <h4 className="text-bold mt0-75">{c('Info').t`Swiss encrypted file storage`}</h4>
                <p className="m0 mt0-25">
                    {c('Info')
                        .t`With ${DRIVE_APP_NAME}, your data is protected with end-to-end encryption. Only you can decrypt it.`}
                </p>
            </div>
            <ModalTwoFooter>
                <ButtonLike as="a" href={DRIVE_PRICING_PAGE} target="_blank" className="w100" color="norm">{c('Action')
                    .t`Get ${DRIVE_APP_NAME}`}</ButtonLike>
            </ModalTwoFooter>
        </>
    );
};

enum ExitState {
    idle,
    exiting,
    exited,
}
const DesktopUpsellFloatingModal = ({ open, onClose, onBlockNewOpening }: ChildProps) => {
    const [exit, setExit] = useState(() => (open ? ExitState.idle : ExitState.exited));
    const active = exit !== ExitState.exited;
    const previousOpen = usePrevious(open);

    useLayoutEffect(() => {
        if (!previousOpen && open) {
            setExit(ExitState.idle);
        } else if (previousOpen && !open) {
            setExit(ExitState.exiting);
        } else if (!previousOpen && !open && !active) {
            onBlockNewOpening();
        }
    }, [previousOpen, open, active]);

    if (!active) {
        return null;
    }

    const exiting = exit === ExitState.exiting;
    return (
        <Portal>
            <div
                className={clsx(modalTwoRootClassName, 'upsell-floating-modal', exiting && 'modal-two--out')}
                onAnimationEnd={({ animationName }) => {
                    if (exiting && animationName === 'anime-modal-two-out') {
                        setExit(ExitState.exited);
                    }
                }}
            >
                <Dialog className="modal-two-dialog upsell-floating-modal-dialog ">
                    <div className="modal-two-dialog-container">
                        <UpsellFloatingModalContent onClose={onClose} />
                    </div>
                </Dialog>
            </div>
        </Portal>
    );
};

const MobileUpsellFloatingModal = ({ open, onClose, onBlockNewOpening }: ChildProps) => {
    const ref = useRef<HTMLDivElement>(null);

    const handleClose = () => {
        onClose();
        onBlockNewOpening();
    };

    // We listen for click outside and test if the click will contain the ref
    const handleOutsideClick = (e: ReactMouseEvent<HTMLDivElement, MouseEvent>) => {
        if (e.target && !ref.current?.contains(e.target as Element)) {
            handleClose();
        }
    };

    return (
        // TODO: need to find a better way than put a click on div
        <div onClick={handleOutsideClick}>
            <ModalTwo open={open} onClose={handleClose}>
                <div ref={ref}>
                    <UpsellFloatingModalContent onClose={handleClose} />
                </div>
            </ModalTwo>
        </div>
    );
};

interface Props {
    onResolve: () => void;
    open: boolean;
    onlyOnce: boolean;
}
const UpsellFloatingModal = ({ onResolve, open, onlyOnce = false }: Props) => {
    const { isNarrow } = useActiveBreakpoint();
    const [wasOpened, setWasOpened] = useState(false);

    const handleBlockNewOpening = () => {
        if (onlyOnce) {
            setWasOpened(true);
        }
    };

    const props = {
        open,
        onClose: onResolve,
        onBlockNewOpening: handleBlockNewOpening,
    };

    if (wasOpened) {
        return null;
    }

    if (isNarrow) {
        return <MobileUpsellFloatingModal {...props} />;
    }

    return <DesktopUpsellFloatingModal {...props} />;
};

export default UpsellFloatingModal;
