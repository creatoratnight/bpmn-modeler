import React from 'react';
import { Modal, TextInput, Button } from '@carbon/react';
import { Copy } from '@carbon/react/icons';
import toastr from 'toastr';

const ShareModal = ({ isOpen, onClose, url }) => {
    const copyToClipboard = () => {
        navigator.clipboard.writeText(url).then(() => {
            toastr.success('Link copied to clipboard!');
        }, (err) => {
            toastr.error('Failed to copy link: ', err);
        });
    };

    if (!isOpen) return null;

    return (
        <Modal
            open={isOpen}
            modalHeading="Share"
            passiveModal
            onRequestClose={onClose}
        >
            <p style={{ marginBottom: '1rem' }}>Only members of the project can view this page.</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <TextInput
                    id="share-url-input"
                    labelText="Shareable Link"
                    value={url}
                    readOnly
                    style={{ flexGrow: 1 }}
                />
                <Button hasIconOnly renderIcon={Copy} iconDescription="Copy link" onClick={copyToClipboard} tooltipPosition="left" style={{ flexShrink: 0, marginTop: '1rem' }} />
            </div>
        </Modal>
    );
};

export default ShareModal;