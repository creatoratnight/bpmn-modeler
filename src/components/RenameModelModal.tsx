import React, { useState, useEffect } from 'react';
import {Modal, TextInput} from "@carbon/react";

const RenameModelModal = ({ isOpen, onClose, onRenameModel, currentName }) => {
    const [newModelName, setNewModelName] = useState('');

    useEffect(() => {
            setNewModelName(currentName);
        }, [currentName]);

    const handleRenameModel = () => {
        onRenameModel(newModelName);
        setNewModelName('');
        onClose();
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && newModelName.trim()) {
            handleRenameModel();
        }
    };

    if (!isOpen) return null;

    return (
        <Modal modalHeading="Rename Model" primaryButtonText="Rename model" secondaryButtonText="Cancel" open={isOpen} onRequestClose={onClose} onRequestSubmit={handleRenameModel} primaryButtonDisabled={!newModelName.trim()}>
            <TextInput data-modal-primary-focus id="text-input-1" labelText="Model name" placeholder="New model"
                       value={newModelName}
                       onChange={(e) => setNewModelName(e.target.value)}
                       onKeyDown={handleKeyDown}
                       style={{
                           marginBottom: '1rem'
                       }} />
        </Modal>
    );
};

export default RenameModelModal;
