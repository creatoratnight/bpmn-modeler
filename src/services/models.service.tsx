import {getDatabase, ref, update, push, set, get, remove} from "firebase/database";

export const saveBPMNModel = (model) => {
    const db = getDatabase();
    const updates = {};

    // Update individual fields rather than replacing the whole node, so that the
    // `milestones` child stored under the model is preserved across saves.
    updates[`/bpmnModels/${model.id}/name`] = model.name;
    updates[`/bpmnModels/${model.id}/type`] = 'bpmn';
    updates[`/bpmnModels/${model.id}/ownerId`] = model.ownerId;
    updates[`/bpmnModels/${model.id}/folder`] = model.folder || null;
    updates[`/bpmnModels/${model.id}/projectId`] = model.projectId;
    updates[`/bpmnModels/${model.id}/updatedAt`] = new Date().toISOString();
    updates[`/modelXmlData/${model.id}/xmlData`] = model.xmlData;

    return update(ref(db), updates).then(() => {
        console.log('BPMN model saved successfully.');
    }).catch((error) => {
        console.error('Error saving BPMN model: ', error);
    });
};

// Persist just the XML (and touch updatedAt) for a model. Used by the
// collaboration persistence leader, which writes the shared document to the
// database on a slow debounce — decoupled from the fast live-sync cadence, and
// with a single writer per session so concurrent editors never overwrite each
// other's whole file. Metadata (name/type/owner/...) is untouched here because
// it does not change while editing the diagram.
export const persistCollaborativeXml = (modelId, xml) => {
    const db = getDatabase();
    const updates = {};
    updates[`/modelXmlData/${modelId}/xmlData`] = xml;
    updates[`/bpmnModels/${modelId}/updatedAt`] = new Date().toISOString();

    return update(ref(db), updates).catch((error) => {
        console.error('Error persisting collaborative XML: ', error);
    });
};

export const saveDMNodel = (model) => {
    const db = getDatabase();
    const updates = {};

    // Update individual fields rather than replacing the whole node, so that the
    // `milestones` child stored under the model is preserved across saves.
    updates[`/bpmnModels/${model.id}/name`] = model.name;
    updates[`/bpmnModels/${model.id}/type`] = 'dmn';
    updates[`/bpmnModels/${model.id}/ownerId`] = model.ownerId;
    updates[`/bpmnModels/${model.id}/projectId`] = model.projectId;
    updates[`/bpmnModels/${model.id}/updatedAt`] = new Date().toISOString();
    updates[`/modelXmlData/${model.id}/xmlData`] = model.xmlData;

    return update(ref(db), updates).then(() => {
        console.log('DMN model saved successfully.');
    }).catch((error) => {
        console.error('Error saving DMN model: ', error);
    });
};

// Milestones are stored as two parts:
//   - lightweight metadata under the model:  bpmnModels/{modelId}/milestones/{milestoneId}
//   - the heavy XML snapshot on its own:      milestoneData/{milestoneId}
// This lets the list be shown from the model data alone (name/description/date),
// while the XML is only fetched when a milestone is actually loaded.
//
// The snapshot carries `modelId` back to its model. That is what lets the
// security rules scope it to the model's project — a snapshot keyed only by its
// own id cannot be tied to a project, and would have to be readable by every
// signed-in user.
export const saveMilestone = async (modelId, name, description, xmlData, userId) => {
    const db = getDatabase();
    const milestoneId = push(ref(db, `milestoneData`)).key;

    const updates = {};
    updates[`/bpmnModels/${modelId}/milestones/${milestoneId}`] = {
        name,
        description,
        createdBy: userId,
        createdAt: new Date().toISOString()
    };
    updates[`/milestoneData/${milestoneId}`] = { modelId, xmlData };

    await update(ref(db), updates);
    return milestoneId;
};

export const getMilestones = async (modelId) => {
    const db = getDatabase();
    const milestonesRef = ref(db, `bpmnModels/${modelId}/milestones`);
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

// Fetch the XML snapshot for a single milestone on demand (loaded only when needed).
export const getMilestoneXml = async (milestoneId) => {
    const db = getDatabase();
    const snapshot = await get(ref(db, `milestoneData/${milestoneId}/xmlData`));
    return snapshot.exists() ? snapshot.val() : null;
};

// The milestone ids for a model, used to clean up their XML data on cascade deletes.
export const getModelMilestoneIds = async (modelId) => {
    const db = getDatabase();
    const snapshot = await get(ref(db, `bpmnModels/${modelId}/milestones`));
    return snapshot.exists() ? Object.keys(snapshot.val()) : [];
};

export const deleteMilestone = async (modelId, milestoneId) => {
    const db = getDatabase();
    const updates = {};
    updates[`/bpmnModels/${modelId}/milestones/${milestoneId}`] = null;
    updates[`/milestoneData/${milestoneId}`] = null;
    return update(ref(db), updates);
};

// One-off migration from the legacy layout — where every milestone (including its
// XML snapshot) was grouped under the model at `milestones/{modelId}/{milestoneId}` —
// to the split layout used by the app:
//   - bpmnModels/{modelId}/milestones/{milestoneId}  (metadata)
//   - milestoneData/{milestoneId}/xmlData            (snapshot)
// Runs client-side with the signed-in user's permissions. Milestone ids are
// preserved, so it is idempotent: re-running rewrites the same data, and once the
// legacy `milestones/` node is gone it is a no-op. Returns a summary of what moved.
export const migrateMilestones = async ({ keepLegacy = false } = {}) => {
    const db = getDatabase();
    const legacySnapshot = await get(ref(db, 'milestones'));

    if (!legacySnapshot.exists()) {
        return { models: 0, milestones: 0 };
    }

    const legacy = legacySnapshot.val();
    const updates = {};
    let models = 0;
    let milestones = 0;

    for (const modelId of Object.keys(legacy)) {
        const modelMilestones = legacy[modelId];
        if (!modelMilestones || typeof modelMilestones !== 'object') continue;

        models += 1;

        for (const milestoneId of Object.keys(modelMilestones)) {
            const { name, description, xmlData, createdBy, createdAt } = modelMilestones[milestoneId] || {};

            updates[`/bpmnModels/${modelId}/milestones/${milestoneId}`] = {
                name: name ?? null,
                description: description ?? null,
                createdBy: createdBy ?? null,
                createdAt: createdAt ?? null
            };
            updates[`/milestoneData/${milestoneId}`] = xmlData ? { modelId, xmlData } : null;

            milestones += 1;
        }

        if (!keepLegacy) {
            updates[`/milestones/${modelId}`] = null;
        }
    }

    if (milestones === 0) {
        return { models, milestones: 0 };
    }

    await update(ref(db), updates);
    return { models, milestones };
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