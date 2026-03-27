import {getDatabase, ref, update} from "firebase/database";

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