import React, { useState, useEffect } from 'react';
import {Modal, TextInput} from "@carbon/react";

const RenameProjectModal = ({ isOpen, onClose, onRenameProject, currentName }) => {
    const [newProjectName, setNewProjectName] = useState('');

    useEffect(() => {
        if (isOpen) {
            setNewProjectName(currentName || '');
        }
    }, [isOpen, currentName]);

    const handleRenameProject = () => {
        onRenameProject(newProjectName);
        setNewProjectName('');
        onClose();
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && newProjectName.trim()) {
            handleRenameProject();
        }
    };

    if (!isOpen) return null;

    return (
        <Modal modalHeading="Rename Project" primaryButtonText="Rename project" secondaryButtonText="Cancel" open={isOpen} onRequestClose={onClose} onRequestSubmit={handleRenameProject} primaryButtonDisabled={!newProjectName.trim()}>
            <TextInput data-modal-primary-focus id="text-input-1" labelText="Project name" placeholder="New project"
                       value={newProjectName}
                       onChange={(e) => setNewProjectName(e.target.value)}
                       onKeyDown={handleKeyDown}
                       style={{
                           marginBottom: '1rem'
                       }} />
        </Modal>
    );
};

export default RenameProjectModal;
