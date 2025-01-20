import React, { useState } from 'react';
import {Modal, TextInput} from "@carbon/react";

const RenameProjectModal = ({ isOpen, onClose, onRenameProject, currentName }) => {
    const [newProjectName, setNewProjectName] = useState('');

    const handleRenameProject = () => {
        onRenameProject(newProjectName);
        setNewProjectName('');
        onClose();
    };

    if (!isOpen) return null;

    return (
        <Modal modalHeading="Rename Project" primaryButtonText="Rename project" secondaryButtonText="Cancel" open={isOpen} onRequestClose={onClose} onRequestSubmit={handleRenameProject}>
            <TextInput data-modal-primary-focus id="text-input-1" labelText="Project name" placeholder="New project"
                       value={newProjectName !== '' ? newProjectName : currentName}
                       onChange={(e) => setNewProjectName(e.target.value)}
                       style={{
                           marginBottom: '1rem'
                       }} />
        </Modal>
    );
};

export default RenameProjectModal;
