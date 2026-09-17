import {equalTo, get, getDatabase, orderByChild, query, ref, update} from "firebase/database";

/**
 * Delete a project and everything that hangs off it — models, their XML and
 * milestone snapshots, and the project's invitations — as a single atomic
 * multi-path update.
 *
 * Order and atomicity are load-bearing, not tidiness. Access to a model is
 * resolved through its project, and access to an XML blob or a milestone
 * snapshot through its model, so anything deleted before its dependants leaves
 * them permanently unreachable — and unreadable to the security rules, which
 * would refuse the very deletes that clean them up. One update avoids that
 * entirely: every path in it is authorised against the state *before* the
 * update, while the whole chain is still intact.
 */
export async function deleteProjectCascade(projectId, userId) {
    const db = getDatabase();
    const updates = {};

    const projectSnapshot = await get(ref(db, `projects/${projectId}`));

    const modelsQuery = query(ref(db, 'bpmnModels'), orderByChild('projectId'), equalTo(projectId));
    const modelsSnapshot = await get(modelsQuery);
    modelsSnapshot.forEach((childSnapshot) => {
        updates[`/bpmnModels/${childSnapshot.key}`] = null;
        updates[`/modelXmlData/${childSnapshot.key}`] = null;
        updates[`/milestones/${childSnapshot.key}`] = null; // legacy pre-migration layout

        // Milestone metadata lives under the model node (removed above), but the
        // XML snapshots live separately under milestoneData/{milestoneId}.
        childSnapshot.child('milestones').forEach((milestoneSnapshot) => {
            updates[`/milestoneData/${milestoneSnapshot.key}`] = null;
        });
    });

    const invitesQuery = query(ref(db, 'invitations'), orderByChild('projectId'), equalTo(projectId));
    const invitesSnapshot = await get(invitesQuery);
    invitesSnapshot.forEach((childSnapshot) => {
        updates[`/invitations/${childSnapshot.key}`] = null;
    });

    // Clear the reverse index so no member is left pointing at a project that is
    // gone. A member may only clear their own entry; the owner may clear everyone's,
    // so for anyone else we take just our own and leave the rest as they are.
    if (userId && projectSnapshot.child('ownerId').val() === userId) {
        projectSnapshot.child('members').forEach((memberSnapshot) => {
            updates[`/users/${memberSnapshot.key}/projects/${projectId}`] = null;
        });
    } else if (userId) {
        updates[`/users/${userId}/projects/${projectId}`] = null;
    }

    updates[`/projects/${projectId}`] = null;

    await update(ref(db), updates);
}
