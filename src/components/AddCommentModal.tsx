import React, { useState } from 'react';
import { Modal, TextArea } from '@carbon/react';

const AddCommentModal = ({ isOpen, onClose, onAddComment }) => {
    const [commentText, setCommentText] = useState('');

    const handleSubmit = () => {
        onAddComment(commentText);
        setCommentText('');
    };

    if (!isOpen) return null;

    return (
        <Modal
            open={isOpen}
            modalHeading="Add Comment"
            primaryButtonText="Save Comment"
            secondaryButtonText="Cancel"
            onRequestClose={() => {
                setCommentText('');
                onClose();
            }}
            onRequestSubmit={handleSubmit}
            primaryButtonDisabled={!commentText.trim()}
        >
            <TextArea
                id="comment-text-area"
                labelText="Comment"
                placeholder="Type your comment here..."
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                rows={4}
                data-modal-primary-focus
            />
        </Modal>
    );
};

export default AddCommentModal;