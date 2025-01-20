import React, { useState } from 'react';
import {Modal, TextInput} from "@carbon/react";

const AddProjectModal = ({ isOpen, onClose, onAddProject }) => {
    const [newProjectName, setNewProjectName] = useState('');

    const handleAddProject = () => {
        onAddProject(newProjectName);
        setNewProjectName('');
        onClose();
    };

    if (!isOpen) return null;

    return (
        <Modal modalHeading="Add Project" modalLabel="Projects" primaryButtonText="Add project" secondaryButtonText="Cancel" open={isOpen} onRequestClose={onClose} onRequestSubmit={handleAddProject}>
            <TextInput data-modal-primary-focus id="text-input-1" labelText="Project name" placeholder="New Project"
                       value={newProjectName}
                       onChange={(e) => setNewProjectName(e.target.value)}
                       style={{
                marginBottom: '1rem'
            }} />
        </Modal>
    );
};

export default AddProjectModal;
