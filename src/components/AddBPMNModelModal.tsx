import React, { useState } from 'react';
import {Modal, TextInput} from "@carbon/react";

const AddBPMNModelModal = ({ isOpen, onClose, onAddModel, projectId }) => {
    const [newModelName, setNewModelName] = useState('');

    const handleAddModel = () => {
        onAddModel(projectId, newModelName);
        setNewModelName('');
        onClose();
    };

    if (!isOpen) return null;

    return (
        <Modal modalHeading="Add model" primaryButtonText="Add model" secondaryButtonText="Cancel" open={isOpen} onRequestClose={onClose} onRequestSubmit={handleAddModel}>
            <TextInput data-modal-primary-focus id="text-input-1" labelText="Model name" placeholder="New model"
                       value={newModelName}
                       onChange={(e) => setNewModelName(e.target.value)}
                       style={{
                           marginBottom: '1rem'
                       }} />
        </Modal>
    );
};

export default AddBPMNModelModal;
