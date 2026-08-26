import {equalTo, get, getDatabase, orderByChild, query, ref, remove} from "firebase/database";

export async function deleteModelsAndInvites(projectId) {
    const db = getDatabase();

    const modelsQuery = query(ref(db, 'bpmnModels'), orderByChild('projectId'), equalTo(projectId));
    const modelsSnapshot = await get(modelsQuery);
    modelsSnapshot.forEach((childSnapshot) => {
        remove(ref(db, `bpmnModels/${childSnapshot.key}`));
        remove(ref(db, `modelXmlData/${childSnapshot.key}`));
        remove(ref(db, `milestones/${childSnapshot.key}`)); // legacy pre-migration layout

        // Milestone metadata lives under the model node (removed above), but the
        // XML snapshots live separately under milestoneData/{milestoneId}.
        const milestones = childSnapshot.child('milestones');
        if (milestones.exists()) {
            milestones.forEach((milestoneSnapshot) => {
                remove(ref(db, `milestoneData/${milestoneSnapshot.key}`));
            });
        }
    });

    const invitesQuery = query(ref(db, 'invitations'), orderByChild('projectId'), equalTo(projectId));
    const invitesSnapshot = await get(invitesQuery);
    invitesSnapshot.forEach((childSnapshot) => {
        remove(ref(db, `invitations/${childSnapshot.key}`));
    });
}