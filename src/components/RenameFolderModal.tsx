import React, { useEffect, useState } from 'react';
import {Modal, TextInput} from "@carbon/react";

const RenameFolderModal = ({ isOpen, onClose, onRenameFolder, currentName, projectId }) => {
    const [newFolderName, setNewFolderName] = useState('');

    useEffect(() => {
        setNewFolderName(currentName);
    }, [currentName]);


    const handleRenameFolder = () => {
        onRenameFolder(projectId, newFolderName);
        setNewFolderName('');
        onClose();
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && newFolderName.trim()) {
            handleRenameFolder();
        }
    };

    if (!isOpen) return null;

    return (
        <Modal modalHeading="Rename folder" primaryButtonText="Rename folder" secondaryButtonText="Cancel" open={isOpen} onRequestClose={onClose} onRequestSubmit={handleRenameFolder} primaryButtonDisabled={!newFolderName.trim()}>
            <TextInput data-modal-primary-focus id="text-input-1" labelText="Folder name" placeholder="New folder"
                       value={newFolderName}
                       onChange={(e) => setNewFolderName(e.target.value)}
                       onKeyDown={handleKeyDown}
                       style={{
                           marginBottom: '1rem'
                       }} />
        </Modal>
    );
};

export default RenameFolderModal;
