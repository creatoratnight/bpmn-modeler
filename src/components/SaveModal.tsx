import React from 'react';
import {Modal, TextInput} from "@carbon/react";

const SaveModal = ({ isOpen, onSave, onDiscard }) => {
    if (!isOpen) return null;

    return (
        <Modal modalHeading="Do you want to save your changes?" primaryButtonText="Save changes" secondaryButtonText="Discard changes" open={isOpen} onRequestClose={onDiscard} onRequestSubmit={onSave}>
            <p>You have unsaved changes in your BPMN model, do you want to save your model before leaving?</p>
        </Modal>
    );
};

export default SaveModal;
