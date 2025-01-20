import React, { useState } from 'react';
import {Modal, TextInput} from "@carbon/react";

const RenameModelModal = ({ isOpen, onClose, onRenameModel, currentName }) => {
    const [newModelName, setNewModelName] = useState('');

    const handleRenameModel = () => {
        onRenameModel(newModelName);
        setNewModelName('');
        onClose();
    };

    if (!isOpen) return null;

    return (
        <Modal modalHeading="Rename Model" primaryButtonText="Rename model" secondaryButtonText="Cancel" open={isOpen} onRequestClose={onClose} onRequestSubmit={handleRenameModel}>
            <TextInput data-modal-primary-focus id="text-input-1" labelText="Model name" placeholder="New model"
                       value={newModelName !== '' ? newModelName : currentName}
                       onChange={(e) => setNewModelName(e.target.value)}
                       style={{
                           marginBottom: '1rem'
                       }} />
        </Modal>
    );
};

export default RenameModelModal;
