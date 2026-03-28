import React, {useState, useEffect, ChangeEvent, useRef} from 'react';
import {get, getDatabase, ref, push, set, remove, query, orderByChild, equalTo, update} from "firebase/database";
import InviteModal from './InviteModal.tsx'
import AddBPMNModelModal from './AddBPMNModelModal.tsx';
import AddProjectModal from "./AddProjectModal.tsx";
import ConfirmationModal from "./ConfirmationModal.tsx";
import toastr from 'toastr';
import RenameProjectModal from "./RenameProjectModal.tsx";
import RenameModelModal from "./RenameModelModal.tsx";
import {
    Button,
    DataTable, Heading,
    OverflowMenu,
    OverflowMenuItem,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableHeader,
    TableRow,
    TableToolbar,
    TableToolbarContent, Tile,
    TableBatchActions,
    TableBatchAction,
    TableSelectAll,
    TableSelectRow,
    Checkbox
} from "@carbon/react";
import {DecisionTree, TableSplit, Upload, UserFollow, Add, Close, Group, Folder, Folders, FolderParent, TrashCan, Move, Copy, Download, Share} from '@carbon/react/icons';
import {
    extractBpmnProcessName,
    extractDmnTableName,
    camelize,
    downloadXmlAsBpmn,
    convertDateString,
    renderMembersCell,
    sortRows
} from '../services/utils.service.tsx';
import {deleteModelsAndInvites} from '../services/projects.service.tsx';
import AddFolderModal from './AddFolderModal.tsx';
import RenameFolderModal from './RenameFolderModal.tsx';
import MoveModelModal from "./MoveModelModal.tsx";

const ProjectList = ({user, viewMode, currentProject, selectedFolder, onOpenModel, onNavigateHome, onOpenProject, projects, fetchUserProjects, onOpenShareModal}) => {
    const [invitations, setInvitations] = useState([]);
    const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
    const [isAddModelModalOpen, setIsAddModelModalOpen] = useState(false);
    const [isAddDMNModalOpen, setIsAddDMNModalOpen] = useState(false);
    const [isAddFolderModalOpen, setIsAddFolderModalOpen] = useState(false);
    const [isAddProjectModalOpen, setIsAddProjectModalOpen] = useState(false);
    const [isRenameProjectModalOpen, setIsRenameProjectModalOpen] = useState(false);
    const [isRenameModelModalOpen, setIsRenameModelModalOpen] = useState(false);
    const [isRenameFolderModalOpen, setIsRenameFolderModalOpen] = useState(false);
    const [isMoveModelModalOpen, setIsMoveModelModalOpen] = useState(false);
    const [selectedProjectId, setSelectedProjectId] = useState(null);
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
    const [selectedModel, setSelectedModel] = useState({});
    const [bulkMoveModels, setBulkMoveModels] = useState([]);
    const [confirmModalContent, setConfirmModalContent] = useState({
        message: '', onConfirm: () => {
        }
    });

    const [sortDirection, setSortDirection] = useState('NONE');
    const [sortDirectionModels, setSortDirectionModels] = useState('NONE');
    const [sortHeader, setSortHeader] = useState('');
    const [sortHeaderModels, setSortHeaderModels] = useState('');

    const [isMembersPanelOpen, setIsMembersPanelOpen] = useState(() => {
        const savedState = localStorage.getItem('isMembersPanelOpen');
        // Defaults to false if nothing is in localStorage
        return savedState ? JSON.parse(savedState) : false;
    });

    const fileInputRef = useRef(null);

    const updateLastChangedDate = (projectId) => {
        const db = getDatabase();
        const projectRef = ref(db, `projects/${projectId}`);
        update(projectRef, { updatedAt: new Date().toISOString() });
    };

    // Fetch projects when component mounts or userId changes
    useEffect(() => {
        fetchUserProjects();
        fetchInvites();
    }, [user.uid, fetchUserProjects]);

    // Save side panel state to localStorage
    useEffect(() => {
        localStorage.setItem('isMembersPanelOpen', JSON.stringify(isMembersPanelOpen));
    }, [isMembersPanelOpen]);

    const handleAddProject = (newProjectName) => {
        if (newProjectName) {
            const db = getDatabase();
            const projectsRef = ref(db, 'projects');

            // Generate a new project ID
            const newProjectRef = push(projectsRef);
            const projectId = newProjectRef.key;

            const updates = {};
            updates['/users/' + user.uid + '/projects/' + projectId] = true;

            update(ref(db), updates);

            // Set the project data
            set(newProjectRef, {
                name: newProjectName,
                description: '',
                ownerId: user.uid,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                members: {
                    [user.uid]: 'owner'
                }
            }).then(() => {
                toastr.success('New project added successfully');
                fetchUserProjects();
            }).catch((error) => {
                toastr.error('Error adding new project: ', error);
            });
        }
    };

    const handleRenameProject = (newProjectName) => {
        const db = getDatabase();
        const projectRef = ref(db, `projects/${currentProject.id}`);

        update(projectRef, {name: newProjectName, updatedAt: new Date().toISOString()})
            .then(() => {
                fetchUserProjects();
                toastr.success("Project name updated successfully");
            })
            .catch((error) => toastr.error("Error updating project name: ", error));
    }

    const handleAddBPMNModel = (projectId, newModelName) => {
        if (newModelName) {
            const db = getDatabase();
            const newModelRef = push(ref(db, 'bpmnModels'));
            const modelId = newModelRef.key;

            const xmlData = `<?xml version="1.0" encoding="UTF-8"?>
                            <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" xmlns:modeler="http://camunda.org/schema/modeler/1.0" id="Definitions_1y9ob7p" targetNamespace="http://bpmn.io/schema/bpmn" exporter="Camunda Modeler" exporterVersion="5.19.0" modeler:executionPlatform="Camunda Platform" modeler:executionPlatformVersion="7.20.0">
                              <bpmn:process id="${camelize(newModelName)}" name="${newModelName}" isExecutable="true" camunda:historyTimeToLive="180">
                                <bpmn:startEvent id="StartEvent_1" />
                              </bpmn:process>
                              <bpmndi:BPMNDiagram id="BPMNDiagram_1">
                                <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="${camelize(newModelName)}">
                                  <bpmndi:BPMNShape id="_BPMNShape_StartEvent_2" bpmnElement="StartEvent_1">
                                    <dc:Bounds x="179" y="79" width="36" height="36" />
                                  </bpmndi:BPMNShape>
                                </bpmndi:BPMNPlane>
                              </bpmndi:BPMNDiagram>
                            </bpmn:definitions>`;

            const updates = {};
            updates[`/bpmnModels/${modelId}`] = {
                projectId: projectId,
                ownerId: user.uid,
                name: newModelName,
                folder: selectedFolder?.id || null,
                type: 'bpmn',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            updates[`/modelXmlData/${modelId}`] = { xmlData: xmlData };
            updates[`/projects/${projectId}/models/${modelId}`] = true;
            updates[`/projects/${projectId}/updatedAt`] = new Date().toISOString();

            update(ref(db), updates).then(() => {
                toastr.success('New BPMN model added successfully');
                fetchUserProjects();
            }).catch((error) => {
                toastr.error('Error adding new BPMN model: ', error);
            });
        }
    };

    const handleAddDMNModel = (projectId, newModelName) => {
        if (newModelName) {
            const db = getDatabase();
            const newModelRef = push(ref(db, 'bpmnModels'));
            const modelId = newModelRef.key;

            const xmlData = `<?xml version="1.0" encoding="UTF-8"?>
                            <definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" xmlns:dmndi="https://www.omg.org/spec/DMN/20191111/DMNDI/" xmlns:dc="http://www.omg.org/spec/DMN/20180521/DC/" xmlns:modeler="http://camunda.org/schema/modeler/1.0" id="${camelize(newModelName)}Drd" name="${newModelName} DRD" namespace="http://camunda.org/schema/1.0/dmn" exporter="Camunda Modeler" exporterVersion="5.19.0" modeler:executionPlatform="Camunda Platform" modeler:executionPlatformVersion="7.20.0">
                              <decision id="${camelize(newModelName)}" name="${newModelName}">
                                <decisionTable id="DecisionTable_1tsa30h">
                                  <input id="Input_1">
                                    <inputExpression id="InputExpression_1" typeRef="string">
                                      <text></text>
                                    </inputExpression>
                                  </input>
                                  <output id="Output_1" typeRef="string" />
                                </decisionTable>
                              </decision>
                              <dmndi:DMNDI>
                                <dmndi:DMNDiagram>
                                  <dmndi:DMNShape dmnElementRef="${camelize(newModelName)}">
                                    <dc:Bounds height="80" width="180" x="160" y="100" />
                                  </dmndi:DMNShape>
                                </dmndi:DMNDiagram>
                              </dmndi:DMNDI>
                            </definitions>`;

            const updates = {};
            updates[`/bpmnModels/${modelId}`] = {
                projectId: projectId,
                ownerId: user.uid,
                name: newModelName,
                type: 'dmn',
                folder: selectedFolder?.id || null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            updates[`/modelXmlData/${modelId}`] = { xmlData: xmlData };
            updates[`/projects/${projectId}/models/${modelId}`] = true;
            updates[`/projects/${projectId}/updatedAt`] = new Date().toISOString();

            update(ref(db), updates).then(() => {
                toastr.success('New DMN model added successfully');
                fetchUserProjects();
            }).catch((error) => {
                toastr.error('Error adding new DMN model: ', error);
            });
        }
    };

    const handleAddfolder = (projectId, newFolderName) => {
        if (newFolderName) {
            const db = getDatabase();
            const projectFoldersRef = ref(db, '/projects/' + projectId + '/folders/');

            const newProjectFolderRef = push(projectFoldersRef);
            const folderId = newProjectFolderRef.key;

            set(newProjectFolderRef, {
                projectId: projectId,
                ownerId: user.uid,
                name: newFolderName,
                type: 'folder'
            }).then(() => {
                updateLastChangedDate(projectId);
                fetchUserProjects();
                toastr.success('New folder added successfully');
            })
        }
    };

    const onRenameModel = (model) => {
        setSelectedModel(model);
        setIsRenameModelModalOpen(true);
    }

    const onRenameFolder = (model) => {
        setSelectedModel(model);
        setIsRenameFolderModalOpen(true);
    }

    const handleRenameModel = async (newModelName) => {
        const db = getDatabase();
        const modelId = selectedModel.id;

        // 1. Fetch XML data
        const xmlDataRef = ref(db, `modelXmlData/${modelId}`);
        const xmlDataSnapshot = await get(xmlDataRef);
        const currentXmlData = xmlDataSnapshot.exists() ? xmlDataSnapshot.val().xmlData : '';

        const updates = {};
        // Update metadata
        updates[`/bpmnModels/${modelId}/name`] = newModelName;
        updates[`/bpmnModels/${modelId}/updatedAt`] = new Date().toISOString();

        let newXmlData = currentXmlData;
        if (currentXmlData && (selectedModel.type === 'bpmn' || selectedModel.type === 'dmn')) {
            const isBpmn = selectedModel.type === 'bpmn';
            const tagName = isBpmn ? 'bpmn:process' : 'decision';
            const refAttr = isBpmn ? 'bpmnElement' : 'dmnElementRef';

            const newId = camelize(newModelName);

            const idMatch = newXmlData.match(new RegExp(`<${tagName}[^>]+id="([^"]+)"`));
            if (idMatch) {
                const oldId = idMatch[1];

                newXmlData = newXmlData.replace(
                    new RegExp(`(<${tagName}[^>]+id=")([^"]+)(")`),
                    `$1${newId}$3`
                );

                newXmlData = newXmlData.replace(
                    new RegExp(`(<${tagName}[^>]+name=")([^"]+)(")`),
                    `$1${newModelName}$3`
                );

                const escapedOldId = oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const refRegex = new RegExp(`(${refAttr}=")(${escapedOldId})(")`);
                newXmlData = newXmlData.replace(refRegex, `$1${newId}$3`);

                // Update XML data in its own node
                updates[`/modelXmlData/${modelId}/xmlData`] = newXmlData;
            }
        }

        update(ref(db), updates)
            .then(() => {
                updateLastChangedDate(currentProject.id);
                fetchUserProjects();
                toastr.success("Model name updated successfully");
            })
            .catch((error) => toastr.error("Error updating model name: ", error));
    }

    const handleRenameFolder = (projectId, newFolderName) => {
        const db = getDatabase();
        const projectFoldersRef = ref(db, `/projects/${projectId}/folders/${selectedModel.id}`);

        update(projectFoldersRef, {name: newFolderName})
            .then(() => {
                updateLastChangedDate(projectId);
                fetchUserProjects();
                toastr.success("Folder name updated successfully");
            })
            .catch((error) => toastr.error("Error updating model name: ", error));
    }

    const handleMoveModel = (newFolderId) => {
        const db = getDatabase();
        const updates = {};
        const modelsToUpdate = bulkMoveModels.length > 0 ? bulkMoveModels : [selectedModel];

        modelsToUpdate.forEach(model => {
            updates[`bpmnModels/${model.id}/folder`] = newFolderId || null;
            updates[`bpmnModels/${model.id}/updatedAt`] = new Date().toISOString();
        });

        update(ref(db), updates)
            .then(() => {
                updateLastChangedDate(currentProject.id);
                fetchUserProjects();
                toastr.success(modelsToUpdate.length > 1 ? "Models moved successfully" : "Model moved successfully");
                setBulkMoveModels([]);
            })
            .catch((error) => toastr.error("Error moving model: ", error));
    }

    const handleDuplicateModel = async (model) => {
        if (model) {
            const db = getDatabase();

            // 1. Fetch XML data
            const xmlDataRef = ref(db, `modelXmlData/${model.id}`);
            const xmlDataSnapshot = await get(xmlDataRef);
            const xmlData = xmlDataSnapshot.exists() ? xmlDataSnapshot.val().xmlData : '';

            // Generate a new model ID
            const newModelRef = push(ref(db, 'bpmnModels'));
            const newModelId = newModelRef.key;

            const updates = {};
            // Metadata for new model
            updates[`/bpmnModels/${newModelId}`] = {
                projectId: model.projectId,
                ownerId: user.uid,
                name: `${model.name} Copy`,
                type: model.type,
                folder: model.folder || null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            // XML data for new model
            updates[`/modelXmlData/${newModelId}`] = { xmlData: xmlData };
            // Project link
            updates[`/projects/${model.projectId}/models/${newModelId}`] = true;
            updates[`/projects/${model.projectId}/updatedAt`] = new Date().toISOString();

            update(ref(db), updates).then(() => {
                toastr.success('Model duplicated successfully');
                fetchUserProjects();
            }).catch((error) => {
                toastr.error('Error duplicating model: ', error);
            });
        }
    };

    const handleFileChange = (event: ChangeEvent<HTMLInputElement>, projectId: string) => {
        const files = event.target.files;

        if (files && files.length > 0) {
            Array.from(files).forEach((file) => {
                const reader = new FileReader();
                reader.onload = (e: ProgressEvent<FileReader>) => {
                    const text = e.target?.result;
                    if (file.name.endsWith('.bpmn')) {
                        handleUploadBPMNModel(projectId, text as string, file.name);
                    } else if (file.name.endsWith('.dmn')) {
                        handleUploadDMNModel(projectId, text as string, file.name);
                    }
                };
                reader.readAsText(file);
            });
        }
    };

    const handleUploadBPMNModel = (projectId: string, xml: string, filename) => {
        if (xml) {
            const db = getDatabase();
            const newModelRef = push(ref(db, 'bpmnModels'));
            const modelId = newModelRef.key;

            const updates = {};
            updates[`/bpmnModels/${modelId}`] = {
                projectId: projectId,
                ownerId: user.uid,
                name: extractBpmnProcessName(xml) || filename.replace('.bpmn',''),
                type: 'bpmn',
                folder: selectedFolder?.id || null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            updates[`/modelXmlData/${modelId}`] = { xmlData: xml };
            updates[`/projects/${projectId}/models/${modelId}`] = true;
            updates[`/projects/${projectId}/updatedAt`] = new Date().toISOString();

            update(ref(db), updates).then(() => {
                toastr.success('New BPMN model added successfully');
                fileInputRef.current.value = '';
                fetchUserProjects();
            }).catch((error) => {
                toastr.error('Error adding new BPMN model: ', error);
            });
        }
    };

    const handleUploadDMNModel = (projectId: string, xml: string, filename) => {
        if (xml) {
            const db = getDatabase();
            const newModelRef = push(ref(db, 'bpmnModels'));
            const modelId = newModelRef.key;
            
            const updates = {};
            updates[`/bpmnModels/${modelId}`] = {
                projectId: projectId,
                ownerId: user.uid,
                name: extractDmnTableName(xml) || filename.replace('.bpmn',''),
                type: 'dmn',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            updates[`/modelXmlData/${modelId}`] = { xmlData: xml };
            updates[`/projects/${projectId}/models/${modelId}`] = true;
            updates[`/projects/${projectId}/updatedAt`] = new Date().toISOString();

            update(ref(db), updates).then(() => {
                toastr.success('New DMN model added successfully');
                fileInputRef.current.value = '';
                fetchUserProjects();
            }).catch((error) => {
                toastr.error('Error adding new DMN model: ', error);
            });
        }
    };

    const handleUploadButtonClick = () => {
        fileInputRef.current.click();
    };

    const fetchInvites = async () => {
        const db = getDatabase();
        const invitationsRef = ref(db, 'invitations');
        const invitationsQuery = query(invitationsRef, orderByChild('invitedEmail'), equalTo(user.email));

        try {
            const invitationsSnapshot = await get(invitationsQuery);

            if (invitationsSnapshot.exists()) {
                const invitationsData = invitationsSnapshot.val();

                const invitationsList = await Promise.all(Object.keys(invitationsData).map(async (key) => {
                    const invitation = invitationsData[key];
                    let senderName = 'Unknown';
                    let senderEmail = 'Unknown';
                    let projectName = 'Unknown';

                    try {
                        const senderSnapshot = await get(ref(db, `users/${invitation.senderId}`));
                        if (senderSnapshot.exists()) {
                            const senderData = senderSnapshot.val();
                            senderName = senderData.displayName || 'Unknown';
                            senderEmail = senderData.email || 'Unknown';
                        }
                    } catch (error) {
                        console.error('Error fetching sender details:', error);
                    }

                    try {
                        const projectSnapshot = await get(ref(db, `projects/${invitation.projectId}`));
                        if (projectSnapshot.exists()) {
                            const projectData = projectSnapshot.val();
                            projectName = projectData.name || 'Unknown';
                        }
                    } catch (error) {
                        console.error('Error fetching project details:', error);
                    }

                    return {
                        id: key,
                        ...invitation,
                        senderName,
                        senderEmail,
                        projectName
                    };
                }));

                setInvitations(invitationsList);
            } else {
                setInvitations([]);
            }
        } catch (error) {
            toastr.error('Error fetching invitations:', error);
        }
    }

    const openConfirmModal = (message, onConfirm) => {
        setConfirmModalContent({message, onConfirm});
        setIsConfirmModalOpen(true);
    };

    const onDeleteModel = (modelId) => {
        const db = getDatabase();
        const updates = {};
        updates[`/bpmnModels/${modelId}`] = null;
        updates[`/modelXmlData/${modelId}`] = null;
        updates[`/milestones/${modelId}`] = null;
        updates[`/projects/${currentProject.id}/models/${modelId}`] = null;

        update(ref(db), updates).then(() => {
            updateLastChangedDate(currentProject.id);
            toastr.success('Model deleted successfully');
            fetchUserProjects();
            setIsConfirmModalOpen(false);
        }).catch((error) => {
            toastr.error('Error deleting model: ', error);
        });
    }

    const onBulkDeleteModels = (models) => {
        const db = getDatabase();
        const updates = {};
        models.forEach(model => {
            updates[`bpmnModels/${model.id}`] = null;
            updates[`modelXmlData/${model.id}`] = null;
            updates[`milestones/${model.id}`] = null;
            updates[`projects/${currentProject.id}/models/${model.id}`] = null;
        });

        update(ref(db), updates).then(() => {
            updateLastChangedDate(currentProject.id);
            toastr.success(`${models.length} models deleted successfully`);
            fetchUserProjects();
            setIsConfirmModalOpen(false);
        }).catch((error) => {
            toastr.error('Error deleting models: ', error);
        });
    }

    const onBulkDuplicateModels = async (models) => {
        const db = getDatabase();
        const updates = {};
        const projectId = models[0]?.projectId; // Assume all from same project

        for (const model of models) {
            // 1. Fetch XML data
            const xmlDataRef = ref(db, `modelXmlData/${model.id}`);
            const xmlDataSnapshot = await get(xmlDataRef);
            const xmlData = xmlDataSnapshot.exists() ? xmlDataSnapshot.val().xmlData : '';

            // 2. Prepare updates
            const newModelRef = push(ref(db, 'bpmnModels'));
            const newModelId = newModelRef.key;

            // Metadata for new model
            updates[`/bpmnModels/${newModelId}`] = {
                projectId: model.projectId,
                ownerId: user.uid,
                name: `${model.name} Copy`,
                type: model.type,
                folder: model.folder || null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            // XML data for new model
            updates[`/modelXmlData/${newModelId}`] = { xmlData: xmlData };
            // Project link
            updates[`/projects/${model.projectId}/models/${newModelId}`] = true;
        }

        if (projectId) {
            updates[`/projects/${projectId}/updatedAt`] = new Date().toISOString();
        }

        update(ref(db), updates).then(() => {
            toastr.success(`${models.length} models duplicated successfully`);
            fetchUserProjects();
        }).catch((error) => {
            toastr.error('Error duplicating models: ', error);
        });
    }

    const onBulkDownloadModels = async (models) => {
        const db = getDatabase();
        for (const model of models) {
            const xmlDataRef = ref(db, `modelXmlData/${model.id}`);
            const xmlDataSnapshot = await get(xmlDataRef);
            if (xmlDataSnapshot.exists()) {
                downloadXmlAsBpmn({ ...model, xmlData: xmlDataSnapshot.val().xmlData });
            } else {
                toastr.error(`Could not download ${model.name}. Data missing.`);
            }
        }
    }

    const onDeleteProject = () => {
        const db = getDatabase();
        const modelRef = ref(db, `projects/${currentProject.id}`);

        remove(modelRef).then(() => {
            deleteModelsAndInvites(currentProject.id);
            toastr.success('Project deleted successfully');
            fetchUserProjects();
            setIsConfirmModalOpen(false);
            onNavigateHome();
        }).catch((error) => {
            toastr.error('Error deleting project: ', error);
        });
    }

    const onDeleteFolder = (folderId) => {
        const db = getDatabase();
        const projectFolderRef = ref(db, `projects/${currentProject.id}/folders/${folderId}`);

        remove(projectFolderRef).then(() => {
            updateLastChangedDate(currentProject.id);
            toastr.success('Folder deleted successfully');
            fetchUserProjects();
            setIsConfirmModalOpen(false);
        }).catch((error) => {
            toastr.error('Error deleting folder: ', error);
        });
    }

    const handleAccept = (invitation) => {
        acceptInvitation(invitation.id, invitation.projectId, user.uid);
    };

    const acceptInvitation = (invitationId, projectId, userId) => {
        const db = getDatabase();
        const updates = {};
        updates['/invitations/' + invitationId + '/status'] = 'Accepted';
        updates['/projects/' + projectId + '/members/' + userId] = 'editor';
        updates['/users/' + userId + '/projects/' + projectId] = true;
        updates['/projects/' + projectId + '/updatedAt'] = new Date().toISOString();

        update(ref(db), updates).then(() => {
            toastr.success('Invitation accepted and user added to project');
            setIsInviteModalOpen(false);
            fetchInvites();
            fetchUserProjects();
        }).catch((error) => {
            toastr.error('Error accepting invitation:', error);
        });
    };

    const handleDelete = (invitation) => {
        deleteInvitation(invitation.id);
    };

    const deleteInvitation = (invitationId) => {
        const db = getDatabase();

        const updates = {};
        updates['/invitations/' + invitationId + '/status'] = 'Declined';

        update(ref(db), updates).then(() => {
            toastr.success('Invitation successfully declined');
            fetchInvites();
        }).catch((error) => {
            toastr.error('Error removing invitation:', error);
        });
    };

    const handleRemoveMember = (projectId, memberId) => {
        const db = getDatabase();
        const memberRef = ref(db, `projects/${projectId}/members/${memberId}`);
        const userProjectRef = ref(db, `users/${memberId}/projects/${projectId}`);

        remove(userProjectRef);
        remove(memberRef).then(() => {
            updateLastChangedDate(projectId);
            fetchUserProjects();
            setIsConfirmModalOpen(false);
            toastr.success(`Member removed from project successfully`);
        }).catch((error) => {
            toastr.error('Error removing member:', error);
        });
    };

    const handleLeaveProject = (projectId) => {
        const db = getDatabase();
        const memberRef = ref(db, `projects/${projectId}/members/${user.uid}`);
        const userProjectRef = ref(db, `users/${user.uid}/projects/${projectId}`);

        remove(userProjectRef);
        remove(memberRef).then(() => {
            updateLastChangedDate(projectId);
            fetchUserProjects();
            setIsConfirmModalOpen(false);
            toastr.success(`Successfully left the project`);
            onNavigateHome();
        }).catch((error) => {
            toastr.error('Error leaving project:', error);
        });
    };

    const handleOpenModelClick = async (project, model) => {
        if (model.type === 'dmn') {
            // DMN not supported yet, do nothing.
            return;
        }
        if (model.type === 'folder' || model.type === 'folderUp') {
            // This is handled by onOpenModel in the parent, which sets selectedFolder
            onOpenModel(project, model);
            return;
        }
        onOpenModel(project, model);
    };

    return (
        <div className="projects-wrapper">
            {invitations.filter((invite) => invite.status === 'Pending').length > 0 &&
                <div className="projects-invitations">
                    <Heading className="projects-invitations-title">
                        You
                        have {invitations.filter((item) => item.status === 'Pending').length > 1 ? 'invites' : 'an invite'}!
                    </Heading><br/><br/>
                    {invitations.filter((item) => item.status === 'Pending').map((invitation) => (
                        <Tile key={invitation.id} className="invites-tile">
                            <div>
                                Invite for the
                                project <strong>{invitation.projectName}</strong> from <strong>{invitation.senderName}</strong>
                            </div>
                            {invitation.status === 'Pending' && <div className="projects-invitations-invite-buttons">
                                <Button onClick={() => handleAccept(invitation)}>Accept Invite</Button>
                                <Button kind="danger" onClick={() => handleDelete(invitation)}>Decline
                                    Invite
                                </Button>
                            </div>}
                        </Tile>
                    ))}
                </div>}
            <div className="table-wrapper">
                {viewMode === 'ALL_PROJECTS' && (
                    <>
                        <div className="project-heading">
                            <Heading>
                                Your Projects
                            </Heading>
                        </div>
                        <br/><br/>
                        <DataTable
                            rows={sortRows([...projects].filter(project => project.ownerId === user.uid), sortHeader, sortDirection).map(project => ({
                                id: project.id,
                                name: project.name,
                                diagrams: project.models.length,
                                date: convertDateString(project.updatedAt),
                                members: project.members,
                                actions: project.ownerId === user.uid ? project.id : undefined, // Assuming you have a user object with uid
                            }))}
                            headers={[
                                {key: 'name', header: 'Project Name'},
                                {key: 'diagrams', header: 'Models'},
                                {key: 'date', header: 'Last Changed'},
                                {key: 'members', header: 'Members'},
                            ]}
                            render={({rows, headers, getHeaderProps, getRowProps}) => (
                                <TableContainer title="">
                                    <TableToolbar>
                                        <TableToolbarContent>
                                            <Button onClick={() => setIsAddProjectModalOpen(true)}><Add
                                                className="project-name-icon"/> Add Project</Button>
                                        </TableToolbarContent>
                                    </TableToolbar>
                                    <Table>
                                        {rows.length === 0 && (
                                            <TableBody>
                                                <TableRow>
                                                    <TableCell colSpan={headers.length + 1}>
                                                        <div style={{ textAlign: 'center', padding: '50px' }}>
                                                            <Folders size={64} style={{ fill: '#8d8d8d' }} />
                                                            <p style={{ color: '#8d8d8d', marginTop: '1rem' }}>
                                                                No projects yet. Click "Add Project" to get started.
                                                            </p>
                                                            <br/><br/>
                                                            <Button onClick={() => setIsAddProjectModalOpen(true)}><Add
                                                                className="project-name-icon"/> Add Project</Button>
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            </TableBody>
                                        )}
                                        <TableHead>
                                            <TableRow>
                                                {headers.map(header => {
                                                    const { key, ...headerProps } = getHeaderProps({
                                                        header,
                                                        isSortable: header.key !== 'actions',
                                                        onClick: () => {
                                                            const newDirection = sortDirection === 'ASC' ? 'DESC' : 'ASC';
                                                            setSortHeader(header.key);
                                                            setSortDirection(sortDirection === 'NONE' || header.key !== sortHeader ? 'ASC' : newDirection);
                                                        },
                                                    });
                                                    return (
                                                        <TableHeader key={key} {...headerProps}>
                                                            {header.header}
                                                        </TableHeader>
                                                    );
                                                })}
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {rows.map(row => {
                                                const { key, ...rowProps } = getRowProps({ row });
                                                return (
                                                    <TableRow key={key} {...rowProps}
                                                              onClick={() => onOpenProject(projects.filter((project) => project.id === row.id)[0])}>
                                                        {row.cells.map(cell => (
                                                            <TableCell key={cell.id}>
                                                                {cell.info.header === 'members' ? (
                                                                    renderMembersCell(cell.value) // Use the rendering function for the members cell
                                                                ) : cell.info.header === 'name' ? (
                                                                    <div className="project-name-with-icon">
                                                                        {<Folders
                                                                                className="project-name-icon"/>} {cell.value}
                                                                    </div>
                                                                ) :
                                                                (
                                                                    cell.value
                                                                )}
                                                            </TableCell>
                                                        ))}
                                                    </TableRow>
                                                );
                                            })}
                                        </TableBody>
                                    </Table>
                                </TableContainer>
                            )}
                        />
                        {projects.filter(project => project.ownerId !== user.uid).length > 0 && (
                            <>
                                <br/><br/>
                                <div className="project-heading">
                                    <Heading>
                                        Shared with me
                                    </Heading>
                                </div>
                                <br/><br/>
                                <DataTable
                                    rows={sortRows([...projects].filter(project => project.ownerId !== user.uid), sortHeader, sortDirection).map(project => ({
                                        id: project.id,
                                        name: project.name,
                                        diagrams: project.models.length,
                                        date: convertDateString(project.updatedAt),
                                        members: project.members,
                                        actions: undefined, 
                                    }))}
                                    headers={[
                                        {key: 'name', header: 'Project Name'},
                                        {key: 'diagrams', header: 'Models'},
                                        {key: 'date', header: 'Last Changed'},
                                        {key: 'members', header: 'Members'},
                                    ]}
                                    render={({rows, headers, getHeaderProps, getRowProps}) => (
                                        <TableContainer title="">
                                            <Table>
                                                <TableHead>
                                                    <TableRow>
                                                        {headers.map(header => {
                                                            const { key, ...headerProps } = getHeaderProps({
                                                                header,
                                                                isSortable: header.key !== 'actions',
                                                                onClick: () => {
                                                                    const newDirection = sortDirection === 'ASC' ? 'DESC' : 'ASC';
                                                                    setSortHeader(header.key);
                                                                    setSortDirection(sortDirection === 'NONE' || header.key !== sortHeader ? 'ASC' : newDirection);
                                                                },
                                                            });
                                                            return (
                                                                <TableHeader key={key} {...headerProps}>
                                                                    {header.header}
                                                                </TableHeader>
                                                            );
                                                        })}
                                                    </TableRow>
                                                </TableHead>
                                                <TableBody>
                                                    {rows.map(row => {
                                                        const { key, ...rowProps } = getRowProps({ row });
                                                        return (
                                                            <TableRow key={key} {...rowProps}
                                                                      onClick={() => onOpenProject(projects.filter((project) => project.id === row.id)[0])}>
                                                                {row.cells.map(cell => (
                                                                    <TableCell key={cell.id}>
                                                                        {cell.info.header === 'members' ? (
                                                                            renderMembersCell(cell.value) // Use the rendering function for the members cell
                                                                        ) : cell.info.header === 'name' ? (
                                                                            <div className="project-name-with-icon">
                                                                                {<Folders
                                                                                        className="project-name-icon"/>} {cell.value}
                                                                            </div>
                                                                        ) :
                                                                        (
                                                                            cell.value
                                                                        )}
                                                                    </TableCell>
                                                                ))}
                                                            </TableRow>
                                                        );
                                                    })}
                                                </TableBody>
                                            </Table>
                                        </TableContainer>
                                    )}
                                />
                            </>
                        )}
                    </>
                )}
                {viewMode === 'PROJECT' && currentProject &&
                    <>
                        <div className="project-heading">
                            <Heading>
                                {currentProject.name}
                            </Heading>
                            {currentProject.ownerId === user.uid ? (
                                <div>
                                    <OverflowMenu flipped>
                                        <OverflowMenuItem
                                            itemText="Rename Project"
                                            onClick={(e) => {
                                                e.stopPropagation(); // Prevent triggering row onClick
                                                setIsRenameProjectModalOpen(true);
                                            }}
                                        />
                                        <OverflowMenuItem
                                            itemText="Delete Project"
                                            isDelete
                                            onClick={(e) => {
                                                e.stopPropagation(); // Prevent triggering row onClick
                                                openConfirmModal(
                                                    `Are you sure you want to delete project '${currentProject.name}'?`,
                                                    () => onDeleteProject(currentProject.id)
                                                );
                                            }}
                                        />
                                    </OverflowMenu>
                                </div>
                            ) : (
                                <div>
                                    <OverflowMenu flipped>
                                        <OverflowMenuItem
                                            itemText="Leave Project"
                                            isDelete
                                            onClick={(e) => {
                                                e.stopPropagation(); // Prevent triggering row onClick
                                                openConfirmModal(
                                                    `Are you sure you want to leave project '${currentProject.name}'?`,
                                                    () => handleLeaveProject(currentProject.id)
                                                );
                                            }}
                                        />
                                    </OverflowMenu>
                                </div>
                            )}
                        </div>
                        <br/><br/>
                        <div className="project-wrapper">
                            <div className="project-models-wrapper">
                                <DataTable
                                    isSelectable
                                    rows={sortRows([{'type': 'folderUp', 'id': 'folderUp', 'name': '.. / ' + selectedFolder?.name || '', 'folder': ''}, ...currentProject?.folders.sort((a, b) => a.name.localeCompare(b.name)), ...currentProject.models.sort((a, b) => a.name.localeCompare(b.name))], sortHeaderModels, sortDirectionModels)
                                            .filter(model => model?.folder === selectedFolder?.id || (model?.type === 'folderUp' && selectedFolder?.id))
                                            .map(model => ({
                                        id: model.id || '',
                                        name: model.name || '',
                                        type: model.type || '',
                                        folder: model.folder || '',
                                        owner: currentProject.members.find(member => member.id === model.ownerId)?.displayName || '',
                                        date: model.updatedAt ? convertDateString(model.updatedAt) : '',
                                    }))}
                                    headers={[
                                        {key: 'name', header: 'Name'},
                                        {key: 'type', header: 'Type'},
                                        {key: 'owner', header: 'Owner'},
                                        {key: 'date', header: 'Last Changed'},
                                        {key: 'actions', header: 'Options'},
                                    ]}
                                    render={({rows, headers, getHeaderProps, getSelectionProps, getBatchActionProps, selectedRows, selectRow}) => {
                                        const selectableRows = rows.filter(row => {
                                            const typeCell = row.cells.find(c => c.info.header === 'type');
                                            const type = typeCell ? typeCell.value : '';
                                            return type === 'bpmn' || type === 'dmn';
                                        });
                                        const allSelectableSelected = selectableRows.length > 0 && selectableRows.every(r => r.isSelected);
                                        const someSelectableSelected = selectableRows.some(r => r.isSelected) && !allSelectableSelected;

                                        return (
                                            <TableContainer title="Models">
                                            <TableToolbar>
                                                <TableBatchActions {...getBatchActionProps()}>
                                                    <TableBatchAction
                                                        tabIndex={getBatchActionProps().shouldShowBatchActions ? 0 : -1}
                                                        renderIcon={Download}
                                                        onClick={() => {
                                                            const validRows = selectedRows.filter(r => {
                                                                const item = [...currentProject.folders, ...currentProject.models].find(m => m.id === r.id);
                                                                return item && item.type !== 'folder' && item.type !== 'folderUp';
                                                            });
                                                            if(validRows.length > 0) {
                                                                const models = validRows.map(r => currentProject.models.find(m => m.id === r.id));
                                                                onBulkDownloadModels(models);
                                                            }
                                                        }}
                                                    >
                                                        Download
                                                    </TableBatchAction>
                                                    <TableBatchAction
                                                        tabIndex={getBatchActionProps().shouldShowBatchActions ? 0 : -1}
                                                        renderIcon={Copy}
                                                        onClick={() => {
                                                            const validRows = selectedRows.filter(r => {
                                                                const item = [...currentProject.folders, ...currentProject.models].find(m => m.id === r.id);
                                                                return item && item.type !== 'folder' && item.type !== 'folderUp';
                                                            });
                                                            if(validRows.length > 0) {
                                                                const models = validRows.map(r => currentProject.models.find(m => m.id === r.id));
                                                                onBulkDuplicateModels(models);
                                                            }
                                                        }}
                                                    >
                                                        Duplicate
                                                    </TableBatchAction>
                                                    {currentProject.ownerId === user.uid && <TableBatchAction
                                                        tabIndex={getBatchActionProps().shouldShowBatchActions ? 0 : -1}
                                                        renderIcon={TrashCan}
                                                        onClick={() => {
                                                            const validRows = selectedRows.filter(r => {
                                                                const item = [...currentProject.folders, ...currentProject.models].find(m => m.id === r.id);
                                                                return item && item.type !== 'folder' && item.type !== 'folderUp';
                                                            });
                                                            if(validRows.length > 0) {
                                                                const models = validRows.map(r => currentProject.models.find(m => m.id === r.id));
                                                                openConfirmModal(
                                                                    `Are you sure you want to delete ${models.length} models?`,
                                                                    () => onBulkDeleteModels(models)
                                                                );
                                                            }
                                                        }}
                                                    >
                                                        Delete
                                                    </TableBatchAction>}
                                                    {currentProject.ownerId === user.uid && <TableBatchAction
                                                        tabIndex={getBatchActionProps().shouldShowBatchActions ? 0 : -1}
                                                        renderIcon={Move}
                                                        onClick={() => {
                                                            const validRows = selectedRows.filter(r => {
                                                                const item = [...currentProject.folders, ...currentProject.models].find(m => m.id === r.id);
                                                                return item && item.type !== 'folder' && item.type !== 'folderUp';
                                                            });
                                                            if(validRows.length > 0) {
                                                                const models = validRows.map(r => currentProject.models.find(m => m.id === r.id));
                                                                setBulkMoveModels(models);
                                                                setIsMoveModelModalOpen(true);
                                                            }
                                                        }}
                                                    >
                                                        Move to...
                                                    </TableBatchAction>}
                                                </TableBatchActions>
                                                <TableToolbarContent>
                                                    <div className="cds--toolbar-title">
                                                        Models
                                                    </div>
                                                    <Button onClick={onOpenShareModal}><Share
                                                        className="project-name-icon"/> Share</Button>
                                                    <input style={{display: 'none'}} type="file" accept=".bpmn, .dmn" multiple
                                                           ref={fileInputRef}
                                                           onChange={(event) => handleFileChange(event, currentProject.id)}/>
                                                    <Button onClick={handleUploadButtonClick}><Upload
                                                        className="project-name-icon"/> Import</Button>
                                                    <Button onClick={() => {
                                                        setIsAddModelModalOpen(true);
                                                        setSelectedProjectId(currentProject.id);
                                                    }}><DecisionTree className="project-name-icon"/> Add BPMN
                                                    </Button>
                                                    <Button onClick={() => {
                                                        setIsAddDMNModalOpen(true);
                                                        setSelectedProjectId(currentProject.id);
                                                    }}><TableSplit className="project-name-icon"/> Add DMN
                                                    </Button>
                                                    {!selectedFolder?.id && <Button onClick={() => {
                                                        setIsAddFolderModalOpen(true);
                                                        setSelectedProjectId(currentProject.id);
                                                    }}><Folder className="project-name-icon"/> Add Folder
                                                    </Button>}
                                                </TableToolbarContent>
                                            </TableToolbar>
                                            <Table>
                                                {rows.length === 0 && (
                                                    <TableBody>
                                                        <TableRow>
                                                            <TableCell colSpan={headers.length + 1}>
                                                                <div style={{ textAlign: 'center', padding: '50px' }}>
                                                                    <DecisionTree size={64} style={{ fill: '#8d8d8d' }} />
                                                                    <p style={{ color: '#8d8d8d', marginTop: '1rem' }}>
                                                                        No models in this project. Add or import a model to begin.
                                                                    </p>
                                                                    <br/><br/>
                                                                    <div className="twin-button-wrapper">
                                                                        <Button onClick={() => {
                                                                            setIsAddModelModalOpen(true);
                                                                            setSelectedProjectId(currentProject.id);
                                                                        }}><DecisionTree className="project-name-icon"/> Add BPMN
                                                                        </Button>
                                                                        <input style={{display: 'none'}} type="file" accept=".bpmn, .dmn" multiple
                                                                            ref={fileInputRef}
                                                                            onChange={(event) => handleFileChange(event, currentProject.id)}/>
                                                                        <Button onClick={handleUploadButtonClick}><Upload
                                                                            className="project-name-icon"/> Import</Button>
                                                                    </div>
                                                                </div>
                                                            </TableCell>
                                                        </TableRow>
                                                    </TableBody>
                                                )}
                                                <TableHead>
                                                    <TableRow>
                                                        <TableSelectAll
                                                            {...getSelectionProps()}
                                                            checked={allSelectableSelected}
                                                            indeterminate={someSelectableSelected}
                                                            onSelect={() => {
                                                                if (allSelectableSelected) {
                                                                    selectableRows.forEach(r => selectRow(r.id));
                                                                } else {
                                                                    selectableRows.forEach(r => {
                                                                        if (!r.isSelected) selectRow(r.id);
                                                                    });
                                                                }
                                                            }}
                                                        />
                                                        {headers.map(header => {
                                                            if (header.key === 'actions') return <TableHeader key={header.key} />;
                                                            const { key, ...headerProps } = getHeaderProps({
                                                                header,
                                                                isSortable: header.key !== 'actions',
                                                                onClick: () => {
                                                                    const newDirection = sortDirection === 'ASC' ? 'DESC' : 'ASC';
                                                                    setSortHeaderModels(header.key);
                                                                    setSortDirectionModels(sortDirection === 'NONE' || header.key !== sortHeader ? 'ASC' : newDirection);
                                                                },
                                                            });
                                                            return (
                                                                <TableHeader key={key} {...headerProps}>
                                                                    {header.header}
                                                                </TableHeader>
                                                            );
                                                        })}
                                                    </TableRow>
                                                </TableHead>
                                                <TableBody>
                                                    {rows.map(row => {
                                                        const model = [{'type': 'folderUp', 'id': 'folderUp', 'name': '..'}, ...currentProject.folders, ...currentProject.models].filter(
                                                            (model) => model.id === row.id
                                                        )[0];
                                                        const isFolder = model?.type === 'folder' || model?.type === 'folderUp';
                                                        const { onSelect, ...selectionProps } = getSelectionProps({ row });
                                                        return (
                                                            <TableRow key={row.id}
                                                                      onClick={() => handleOpenModelClick(currentProject, model)}
                                                                      style={model?.type === 'dmn' ? { cursor: 'not-allowed' } : { }}>
                                                                <TableCell className="cds--table-column-checkbox" onClick={(e) => e.stopPropagation()}>
                                                                    <Checkbox
                                                                        {...selectionProps}
                                                                        id={selectionProps.id}
                                                                        labelText={selectionProps['aria-label']}
                                                                        hideLabel
                                                                        disabled={isFolder}
                                                                        onChange={(event) => {
                                                                            onSelect(event);
                                                                        }}
                                                                    />
                                                                </TableCell>
                                                                {row.cells.map((cell) => <TableCell key={cell.id}>
                                                                        {cell.info.header === 'actions' ? (
                                                                            <OverflowMenu flipped>
                                                                                {(model?.type === 'bpmn' || model?.type === 'dmn') &&<OverflowMenuItem
                                                                                    itemText="Download"
                                                    onClick={async (e) => {
                                                                                        e.stopPropagation();
                                                        const db = getDatabase();
                                                        const xmlDataRef = ref(db, `modelXmlData/${model.id}`);
                                                        const xmlDataSnapshot = await get(xmlDataRef);
                                                        if (xmlDataSnapshot.exists()) {
                                                            downloadXmlAsBpmn({ ...model, xmlData: xmlDataSnapshot.val().xmlData });
                                                        } else {
                                                            toastr.error('Could not load model data for download.');
                                                        }
                                                                                    }}
                                                                                />}
                                                                                {(model?.type === 'bpmn' || model?.type === 'dmn') && <OverflowMenuItem
                                                                                    itemText="Duplicate"
                                                                                    onClick={(e) => {
                                                                                        e.stopPropagation();
                                                                                        handleDuplicateModel(model);
                                                                                    }}
                                                                                />}
                                                                                {((model?.type === 'bpmn' || model?.type === 'dmn') && (model?.ownerId === user.uid || currentProject.ownerId === user.uid)) &&
                                                                                    <OverflowMenuItem
                                                                                        itemText="Rename"
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            onRenameModel(model);
                                                                                        }}
                                                                                    />}
                                                                                {(model?.type === 'folder' && (model?.ownerId === user.uid || currentProject.ownerId === user.uid)) &&
                                                                                    <OverflowMenuItem
                                                                                        itemText="Rename"
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            onRenameFolder(model);
                                                                                        }}
                                                                                    />}
                                                                                {((model?.type === 'bpmn' || model?.type === 'dmn') && (model?.ownerId === user.uid || currentProject.ownerId === user.uid)) &&
                                                                                    <OverflowMenuItem
                                                                                        itemText="Move to..."
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            setSelectedModel(model);
                                                                                            setIsMoveModelModalOpen(true);
                                                                                        }}
                                                                                    />}
                                                                                {((model?.type === 'bpmn' || model?.type === 'dmn') && (model?.ownerId === user.uid || currentProject.ownerId === user.uid)) &&
                                                                                    <OverflowMenuItem
                                                                                        itemText="Delete Model"
                                                                                        isDelete
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation(); // Prevent triggering row onClick
                                                                                            openConfirmModal(
                                                                                                `Are you sure you want to delete project '${row.cells[0].value}'?`,
                                                                                                () => onDeleteModel(model.id)
                                                                                            );
                                                                                        }}
                                                                                    />}
                                                                                {(model?.type === 'folder' && (model?.ownerId === user.uid || currentProject.ownerId === user.uid)) && currentProject.models.filter(mod => mod.folder == model.id).length == 0 &&
                                                                                    <OverflowMenuItem
                                                                                        itemText="Delete Folder"
                                                                                        isDelete
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation(); // Prevent triggering row onClick
                                                                                            openConfirmModal(
                                                                                                `Are you sure you want to delete folder '${row.cells[0].value}'?`,
                                                                                                () => onDeleteFolder(model.id)
                                                                                            );
                                                                                        }}
                                                                                    />}
                                                                                {(model?.type === 'folder' && (model?.ownerId === user.uid || currentProject.ownerId === user.uid)) && currentProject.models.filter(mod => mod.folder == model.id).length > 0 &&
                                                                                    <OverflowMenuItem
                                                                                        itemText="Delete Folder"
                                                                                        isDelete
                                                                                        disabled
                                                                                    />}
                                                                            </OverflowMenu>
                                                                        ) : cell.info.header === 'name' ? (
                                                                            <div className="project-name-with-icon">
                                                                                {model?.type === 'bpmn' ? <DecisionTree
                                                                                        className="project-name-icon"/> :
                                                                                    model?.type === 'dmn' ? <TableSplit
                                                                                        className="project-name-icon"/> : 
                                                                                        model?.type === 'folder' ? <Folder className="project-name-icon"/> :
                                                                                            <FolderParent className="project-name-icon"/>} 
                                                                                            {model?.type === 'folderUp' || model?.type === 'folder' ? <strong>{cell.value}</strong> : cell.value}
                                                                            </div>

                                                                        ) : model?.type != 'folderUp' ? (
                                                                                cell.value
                                                                        ) : (<></>)}
                                                                    </TableCell>
                                                                )}
                                                            </TableRow>
                                                        )
                                                    })}
                                                </TableBody>
                                            </Table>
                                        </TableContainer>
                                    );}}
                                />
                            </div>
                            {!isMembersPanelOpen && (
                                <Button
                                    className="open-members-panel-button"
                                    onClick={() => setIsMembersPanelOpen(true)}
                                    hasIconOnly
                                    renderIcon={Group}
                                    iconDescription="Open"
                                    tooltipPosition='top'
                                    size="lg"
                                />
                            )}
                            {isMembersPanelOpen &&
                                <div className="project-members-wrapper">
                                    <DataTable
                                        rows={currentProject.members.map((member) => ({
                                            id: member.id,
                                            avatar: member.imageUrl,
                                            name: member.displayName,
                                            email: member.email,
                                            role: member.role,
                                            actions: member,
                                        }))}
                                        headers={[
                                            {key: 'avatar', header: ''}, // For avatar images
                                            {key: 'name', header: 'Name'},
                                            {key: 'role', header: 'Role'},
                                            {key: 'actions', header: 'Options'}, // For action buttons
                                        ]}
                                        render={({rows, headers, getHeaderProps, getRowProps}) => (
                                            <TableContainer title="Members">
                                                <TableToolbar>
                                                    <TableToolbarContent>
                                                        <div className="cds--toolbar-title">
                                                            Members
                                                        </div>
                                                        <Button onClick={() => {
                                                            setIsInviteModalOpen(true);
                                                            setSelectedProjectId(currentProject.id);
                                                        }}><UserFollow className="project-name-icon"/> Invite
                                                        </Button>
                                                        <Button hasIconOnly kind="ghost" renderIcon={Close} iconDescription="Close" tooltipPosition="top" onClick={() => setIsMembersPanelOpen(false)} />
                                                    </TableToolbarContent>
                                                </TableToolbar>
                                                <Table>
                                                    <TableHead>
                                                        <TableRow>
                                                            {headers.map((header) => {
                                                                const { key, ...headerProps } = getHeaderProps({header});
                                                                return (
                                                                    <TableHeader key={key} {...headerProps}>
                                                                        {header.header}
                                                                    </TableHeader>
                                                                );
                                                            })}
                                                        </TableRow>
                                                    </TableHead>
                                                    <TableBody>
                                                        {rows.map((row) => {
                                                            const { key, ...rowProps } = getRowProps({ row });
                                                            return (
                                                                <TableRow key={key} {...rowProps}>
                                                                    {row.cells.map((cell) => (
                                                                        <TableCell key={cell.id}>
                                                                            {cell.info.header === 'avatar' ? (
                                                                                <img src={cell.value} alt="user-avatar"
                                                                                        style={{
                                                                                            width: '32px',
                                                                                            height: '32px',
                                                                                            borderRadius: '16px'
                                                                                        }}/>
                                                                            ) : cell.info.header === 'actions' && currentProject.ownerId === user.uid && cell.value.id !== user.uid ? (
                                                                                <OverflowMenu flipped>
                                                                                    <OverflowMenuItem
                                                                                        itemText="Remove member"
                                                                                        isDelete
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation(); // Prevent triggering row onClick
                                                                                            openConfirmModal(
                                                                                                `Are you sure you want to remove ${cell.value.displayName} from this project?`,
                                                                                                () => handleRemoveMember(currentProject.id, cell.value.id)
                                                                                            );
                                                                                        }}
                                                                                    />
                                                                                </OverflowMenu>
                                                                            ) : cell.info.header === 'name' ? (
                                                                                cell.value
                                                                            ) : cell.info.header === 'role' ? (
                                                                                cell.value
                                                                            ) : (
                                                                                <></>
                                                                            )}
                                                                        </TableCell>
                                                                    ))}
                                                                </TableRow>
                                                            );
                                                        })}
                                                    </TableBody>
                                                    {rows.length === 1 && (
                                                        <TableBody>
                                                            <TableRow>
                                                                <TableCell colSpan={headers.length + 1}>
                                                                    <div style={{ textAlign: 'center', padding: '50px' }}>
                                                                        <UserFollow size={64} style={{ fill: '#8d8d8d' }} />
                                                                        <p style={{ color: '#8d8d8d', marginTop: '1rem' }}>
                                                                            You are the only member. Invite others to collaborate.
                                                                        </p>
                                                                        <br/><br/>
                                                                        <Button onClick={() => {
                                                                            setIsInviteModalOpen(true);
                                                                            setSelectedProjectId(currentProject.id);
                                                                        }}><UserFollow className="project-name-icon"/> Invite
                                                                        </Button>
                                                                    </div>
                                                                </TableCell>
                                                            </TableRow>
                                                        </TableBody>
                                                    )}
                                                </Table>
                                            </TableContainer>
                                        )}
                                    />
                                </div>
                            }
                        </div>
                    </>}
            </div>

            <ConfirmationModal
                isOpen={isConfirmModalOpen}
                message={confirmModalContent.message}
                onClose={() => setIsConfirmModalOpen(false)}
                onConfirm={confirmModalContent.onConfirm}
            />

            <AddProjectModal
                isOpen={isAddProjectModalOpen}
                onClose={() => setIsAddProjectModalOpen(false)}
                onAddProject={handleAddProject}
            />

            <RenameProjectModal
                isOpen={isRenameProjectModalOpen}
                onClose={() => setIsRenameProjectModalOpen(false)}
                onRenameProject={handleRenameProject}
                currentName={currentProject.name}
            />

            <AddBPMNModelModal
                isOpen={isAddModelModalOpen}
                onClose={() => setIsAddModelModalOpen(false)}
                onAddModel={handleAddBPMNModel}
                projectId={selectedProjectId}
            />

            <AddBPMNModelModal
                isOpen={isAddDMNModalOpen}
                onClose={() => setIsAddDMNModalOpen(false)}
                onAddModel={handleAddDMNModel}
                projectId={selectedProjectId}
            />

            <AddFolderModal
                isOpen={isAddFolderModalOpen}
                onClose={() => setIsAddFolderModalOpen(false)}
                onAddFolder={handleAddfolder}
                projectId={selectedProjectId}
            />

            <RenameModelModal
                isOpen={isRenameModelModalOpen}
                onClose={() => setIsRenameModelModalOpen(false)}
                onRenameModel={handleRenameModel}
                currentName={selectedModel.name}
            />

            <RenameFolderModal
                isOpen={isRenameFolderModalOpen}
                onClose={() => setIsRenameFolderModalOpen(false)}
                onRenameFolder={handleRenameFolder}
                currentName={selectedModel.name}
                projectId={currentProject.id}
            />

            <MoveModelModal
                isOpen={isMoveModelModalOpen}
                onClose={() => {
                    setIsMoveModelModalOpen(false);
                    setBulkMoveModels([]);
                }}
                onMoveModel={handleMoveModel}
                folders={currentProject?.folders || []}
                currentFolderId={bulkMoveModels.length > 0 ? '' : selectedModel?.folder}
            />

            <InviteModal
                isOpen={isInviteModalOpen}
                onClose={() => setIsInviteModalOpen(false)}
                projectId={selectedProjectId}
                userId={user.uid}
            />
        </div>
    );
};

export default ProjectList;
