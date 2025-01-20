import {getDatabase, ref, set} from "firebase/database";

export const saveBPMNModel = (model) => {
    const db = getDatabase();
    set(ref(db, `bpmnModels/${model.id}`), {
        name: model.name,
        type: 'bpmn',
        ownerId: model.ownerId,
        projectId: model.projectId,
        xmlData: model.xmlData,
        updatedAt: new Date().toISOString()
    }).then(() => {
        console.log('BPMN model saved successfully.');
    }).catch((error) => {
        console.error('Error saving BPMN model: ', error);
    });
};

export const saveDMNodel = (model) => {
    const db = getDatabase();
    set(ref(db, `bpmnModels/${model.id}`), {
        name: model.name,
        type: 'dmn',
        ownerId: model.ownerId,
        projectId: model.projectId,
        xmlData: model.xmlData,
        updatedAt: new Date().toISOString()
    }).then(() => {
        console.log('DMN model saved successfully.');
    }).catch((error) => {
        console.error('Error saving DMN model: ', error);
    });
};