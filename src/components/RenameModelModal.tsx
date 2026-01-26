import React, { useState, useEffect } from 'react';
import {Modal, TextInput} from "@carbon/react";

const RenameModelModal = ({ isOpen, onClose, onRenameModel, currentName }) => {
    const [newModelName, setNewModelName] = useState('');

    useEffect(() => {
        if (isOpen) {
            setNewModelName(currentName || '');
        }
    }, [isOpen, currentName]);

    const isValidQName = (name) => /^[a-zA-Z_][\w-.\s]*$/.test(name);
    const isInvalid = newModelName.length > 0 && !isValidQName(newModelName);

    const handleRenameModel = () => {
        onRenameModel(newModelName);
        setNewModelName('');
        onClose();
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && newModelName.trim() && !isInvalid) {
            handleRenameModel();
        }
    };

    if (!isOpen) return null;

    return (
        <Modal modalHeading="Rename Model" primaryButtonText="Rename model" secondaryButtonText="Cancel" open={isOpen} onRequestClose={onClose} onRequestSubmit={handleRenameModel} primaryButtonDisabled={!newModelName.trim() || isInvalid}>
            <TextInput data-modal-primary-focus id="text-input-1" labelText="Model name" placeholder="New model"
                       value={newModelName}
                       invalid={isInvalid}
                       invalidText="Model name must start with a letter or underscore, and contain only alphanumeric characters, underscores, hyphens, periods or spaces"
                       onChange={(e) => setNewModelName(e.target.value)}
                       onKeyDown={handleKeyDown}
                       style={{
                           marginBottom: '1rem'
                       }} />
        </Modal>
    );
};

export default RenameModelModal;
