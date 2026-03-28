import {getDatabase, ref, update, push, set, get, remove} from "firebase/database";

export const saveBPMNModel = (model) => {
    const db = getDatabase();
    const updates = {};

    updates[`/bpmnModels/${model.id}`] = {
        name: model.name,
        type: 'bpmn',
        ownerId: model.ownerId,
        folder: model.folder || null,
        projectId: model.projectId,
        updatedAt: new Date().toISOString()
    };
    updates[`/modelXmlData/${model.id}/xmlData`] = model.xmlData;

    return update(ref(db), updates).then(() => {
        console.log('BPMN model saved successfully.');
    }).catch((error) => {
        console.error('Error saving BPMN model: ', error);
    });
};

export const saveDMNodel = (model) => {
    const db = getDatabase();
    const updates = {};

    updates[`/bpmnModels/${model.id}`] = {
        name: model.name,
        type: 'dmn',
        ownerId: model.ownerId,
        projectId: model.projectId,
        updatedAt: new Date().toISOString()
    };
    updates[`/modelXmlData/${model.id}/xmlData`] = model.xmlData;

    return update(ref(db), updates).then(() => {
        console.log('DMN model saved successfully.');
    }).catch((error) => {
        console.error('Error saving DMN model: ', error);
    });
};

export const saveMilestone = async (modelId, name, description, xmlData, userId) => {
    const db = getDatabase();
    const newMilestoneRef = push(ref(db, `milestones/${modelId}`));
    
    return set(newMilestoneRef, {
        name,
        description,
        xmlData,
        createdBy: userId,
        createdAt: new Date().toISOString()
    });
};

export const getMilestones = async (modelId) => {
    const db = getDatabase();
    const milestonesRef = ref(db, `milestones/${modelId}`);
    const snapshot = await get(milestonesRef);
    
    if (snapshot.exists()) {
        const data = snapshot.val();
        return Object.keys(data).map(key => ({
            id: key,
            ...data[key]
        })).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return [];
};

export const deleteMilestone = async (modelId, milestoneId) => {
    const db = getDatabase();
    const milestoneRef = ref(db, `milestones/${modelId}/${milestoneId}`);
    return remove(milestoneRef);
};

export const saveComment = async (modelId, text, user) => {
    const db = getDatabase();
    const newCommentRef = push(ref(db, `comments/${modelId}`));
    
    return set(newCommentRef, {
        text,
        createdBy: user.uid,
        creatorName: user.displayName || 'Unknown',
        createdAt: new Date().toISOString()
    });
};

export const getComments = async (modelId) => {
    const db = getDatabase();
    const commentsRef = ref(db, `comments/${modelId}`);
    const snapshot = await get(commentsRef);
    
    if (snapshot.exists()) {
        const data = snapshot.val();
        return Object.keys(data).map(key => ({
            id: key,
            ...data[key]
        })).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return [];
};

export const deleteComment = async (modelId, commentId) => {
    const db = getDatabase();
    const commentRef = ref(db, `comments/${modelId}/${commentId}`);
    return remove(commentRef);
};