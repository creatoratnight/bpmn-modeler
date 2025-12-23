import React, { useState, useEffect } from 'react';
import { Modal, Select, SelectItem } from '@carbon/react';

const MoveModelModal = ({ isOpen, onClose, onMoveModel, folders, currentFolderId }) => {
    const [selectedFolder, setSelectedFolder] = useState(currentFolderId || '');

    useEffect(() => {
        if (isOpen) {
            setSelectedFolder(currentFolderId || '');
        }
    }, [isOpen, currentFolderId]);

    const handleSubmit = () => {
        onMoveModel(selectedFolder);
        onClose();
    };

    return (
        <Modal
            open={isOpen}
            modalHeading="Move to..."
            primaryButtonText="Move"
            secondaryButtonText="Cancel"
            onRequestClose={onClose}
            onRequestSubmit={handleSubmit}
        >
            <Select
                id="folder-select"
                labelText="Select Folder"
                value={selectedFolder}
                onChange={(e) => setSelectedFolder(e.target.value)}
            >
                <SelectItem value="" text="Project root (No Folder)" />
                {folders.map((folder) => (
                    <SelectItem key={folder.id} value={folder.id} text={folder.name} />
                ))}
            </Select>
        </Modal>
    );
};

export default MoveModelModal;