import React, {useState} from "react";
import {getDatabase, push, ref, set} from "firebase/database";
import toastr from 'toastr';
import {Modal, TextInput} from "@carbon/react";

const InviteModal = ({ isOpen, onClose, projectId, userId }) => {
    const [inviteEmail, setInviteEmail] = useState('');

    const isValidEmail = (email) => {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    };

    const handleInvite = () => {
        const db = getDatabase();
        const newInvitationRef = push(ref(db, 'invitations'));

        set(newInvitationRef, {
            projectId: projectId,
            invitedEmail: inviteEmail,
            senderId: userId,
            status: 'Pending',
            sentAt: new Date().toISOString()
        }).then(() => {
            toastr.success('Invitation sent');
            onClose();
            setInviteEmail('');
        }).catch(error => {
            toastr.error('Error sending invitation:', error);
        });
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && isValidEmail(inviteEmail)) {
            handleInvite();
        }
    };

    if (!isOpen) return null;

    return (
        <Modal modalHeading="Invite Member" primaryButtonText="Invite member" secondaryButtonText="Cancel" open={isOpen} onRequestClose={onClose} onRequestSubmit={handleInvite} primaryButtonDisabled={!isValidEmail(inviteEmail)}>
            <TextInput data-modal-primary-focus id="text-input-1" labelText="Email address (Google account or Microsoft account)" placeholder="user@example.com"
                       value={inviteEmail}
                       onChange={(e) => setInviteEmail(e.target.value.toLowerCase())}
                       invalid={inviteEmail.length > 0 && !isValidEmail(inviteEmail)}
                       invalidText="Please enter a valid email address"
                       onKeyDown={handleKeyDown}
                       style={{
                           marginBottom: '1rem'
                       }} />
        </Modal>
    );
};

export default InviteModal;