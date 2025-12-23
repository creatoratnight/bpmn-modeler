import React, { useState } from 'react';
import {Modal, TextInput} from "@carbon/react";

const AddFolderModal = ({ isOpen, onClose, onAddFolder, projectId }) => {
    const [newFolderName, setNewFolderName] = useState('');

    const handleAddFolder = () => {
        onAddFolder(projectId, newFolderName);
        setNewFolderName('');
        onClose();
    };

    if (!isOpen) return null;

    return (
        <Modal modalHeading="Add folder" primaryButtonText="Add folder" secondaryButtonText="Cancel" open={isOpen} onRequestClose={onClose} onRequestSubmit={handleAddFolder}>
            <TextInput data-modal-primary-focus id="text-input-1" labelText="Folder name" placeholder="New folder"
                       value={newFolderName}
                       onChange={(e) => setNewFolderName(e.target.value)}
                       style={{
                           marginBottom: '1rem'
                       }} />
        </Modal>
    );
};

export default AddFolderModal;
