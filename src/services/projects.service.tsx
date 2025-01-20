import {equalTo, get, getDatabase, orderByChild, query, ref, remove} from "firebase/database";

export async function deleteModelsAndInvites(projectId) {
    const db = getDatabase();

    const modelsQuery = query(ref(db, 'bpmnModels'), orderByChild('projectId'), equalTo(projectId));
    const modelsSnapshot = await get(modelsQuery);
    modelsSnapshot.forEach((childSnapshot) => {
        remove(ref(db, `bpmnModels/${childSnapshot.key}`));
    });

    const invitesQuery = query(ref(db, 'invitations'), orderByChild('projectId'), equalTo(projectId));
    const invitesSnapshot = await get(invitesQuery);
    invitesSnapshot.forEach((childSnapshot) => {
        remove(ref(db, `invitations/${childSnapshot.key}`));
    });
}