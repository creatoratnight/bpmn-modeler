import React, {useState} from "react";
import {getDatabase, ref, set, get, query, orderByChild, equalTo, limitToFirst} from "firebase/database";
import toastr from 'toastr';
import {Modal, TextInput} from "@carbon/react";
import {invitationKey} from "../services/invites.service";

const InviteModal = ({ isOpen, onClose, projectId, userId }) => {
    const [inviteEmail, setInviteEmail] = useState('');

    const isValidEmail = (email) => {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    };

    const handleInvite = async () => {
        const db = getDatabase();

        // Look for a pending invitation among *this project's* invitations. The
        // security rules authorise that query for a member of the project; they do
        // not allow searching by an address, which would mean reading invitations
        // addressed to other people. A project's invitation list is short.
        const invitationId = invitationKey(projectId, inviteEmail);

        try {
            const projectInvites = query(ref(db, 'invitations'), orderByChild('projectId'), equalTo(projectId));
            const snapshot = await get(projectInvites);
            if (snapshot.child(invitationId).child('status').val() === 'Pending') {
                toastr.warning('An invitation is already pending for this email address.');
                return;
            }
        } catch (error) {
            toastr.error('Error checking for duplicates:', error);
            return;
        }

        const usersRef = ref(db, 'users');
        const userQuery = query(usersRef, orderByChild('email'), equalTo(inviteEmail), limitToFirst(1));

        try {
            const userSnapshot = await get(userQuery);
            if (userSnapshot.exists()) {
                const users = userSnapshot.val();
                const existingUserId = Object.keys(users)[0];
                const memberRef = ref(db, `projects/${projectId}/members/${existingUserId}`);
                const memberSnapshot = await get(memberRef);

                if (memberSnapshot.exists()) {
                    toastr.warning('This user is already a member of the project.');
                    return;
                }
            }
        } catch (error) {
            toastr.error('Error checking project members:', error);
            return;
        }

        set(ref(db, `invitations/${invitationId}`), {
            projectId: projectId,
            invitedEmail: inviteEmail.toLowerCase(),
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