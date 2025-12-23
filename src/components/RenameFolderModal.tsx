import React, { useState } from 'react';
import {Modal, TextInput} from "@carbon/react";

const RenameFolderModal = ({ isOpen, onClose, onRenameFolder, currentName, projectId }) => {
    const [newFolderName, setNewFolderName] = useState('');

    const handleRenameFolder = () => {
        onRenameFolder(projectId, newFolderName);
        setNewFolderName('');
        onClose();
    };

    if (!isOpen) return null;

    return (
        <Modal modalHeading="Rename folder" primaryButtonText="Rename folder" secondaryButtonText="Cancel" open={isOpen} onRequestClose={onClose} onRequestSubmit={handleRenameFolder}>
            <TextInput data-modal-primary-focus id="text-input-1" labelText="Folder name" placeholder="New folder"
                       value={newFolderName !== '' ? newFolderName : currentName}
                       onChange={(e) => setNewFolderName(e.target.value)}
                       style={{
                           marginBottom: '1rem'
                       }} />
        </Modal>
    );
};

export default RenameFolderModal;
