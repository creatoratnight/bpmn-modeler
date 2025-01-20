import React, {useState} from "react";
import {getDatabase, push, ref, set} from "firebase/database";
import toastr from 'toastr';
import {Modal, TextInput} from "@carbon/react";

const InviteModal = ({ isOpen, onClose, projectId, userId }) => {
    const [inviteEmail, setInviteEmail] = useState('');

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
            setInviteEmail(''); // Reset the email input field
        }).catch(error => {
            toastr.error('Error sending invitation:', error);
        });
    };

    if (!isOpen) return null;

    return (
        <Modal modalHeading="Invite Member" primaryButtonText="Invite member" secondaryButtonText="Cancel" open={isOpen} onRequestClose={onClose} onRequestSubmit={handleInvite}>
            <TextInput data-modal-primary-focus id="text-input-1" labelText="Email address (Google account)" placeholder="user@example.com"
                       value={inviteEmail}
                       onChange={(e) => setInviteEmail(e.target.value)}
                       style={{
                           marginBottom: '1rem'
                       }} />
        </Modal>
    );
};

export default InviteModal;