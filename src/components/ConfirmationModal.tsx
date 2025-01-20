import React from 'react';
import {Modal, TextInput} from "@carbon/react";

const ConfirmationModal = ({ isOpen, message, onClose, onConfirm }) => {
    if (!isOpen) return null;

    return (
        <Modal danger modalHeading="Delete" primaryButtonText="Confirm" secondaryButtonText="Cancel" open={isOpen}
               onRequestClose={onClose} onRequestSubmit={onConfirm}>
            <p>{message}</p>
        </Modal>
    );
};

export default ConfirmationModal;
