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
    TableToolbarContent, Tile
} from "@carbon/react";
import {DecisionTree, TableSplit, Upload, UserFollow, Add, Close, Group, Folder, Folders, FolderParent} from '@carbon/react/icons';
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

const ProjectList = ({user, viewMode, currentProject, selectedFolder, onOpenModel, onNavigateHome, onOpenProject}) => {
    const [projects, setProjects] = useState([]);
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

    // Fetch projects when component mounts or userId changes
    useEffect(() => {
        fetchUserProjects(user.uid);
        fetchInvites();
    }, [user.uid]);

    useEffect(() => {
        onOpenProject(projects.filter((project) => project.id === currentProject.id)[0]);
    }, [projects])

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
                fetchUserProjects(user.uid);
            }).catch((error) => {
                toastr.error('Error adding new project: ', error);
            });
        }
    };

    const handleRenameProject = (newProjectName) => {
        const db = getDatabase();
        const projectRef = ref(db, `projects/${currentProject.id}`);

        update(projectRef, {name: newProjectName})
            .then(() => {
                fetchUserProjects(user.uid);
                toastr.success("Project name updated successfully");
            })
            .catch((error) => toastr.error("Error updating project name: ", error));
    }

    const handleAddBPMNModel = (projectId, newModelName) => {
        if (newModelName) {
            const db = getDatabase();
            const bpmnModelsRef = ref(db, 'bpmnModels');

            // Generate a new model ID
            const newModelRef = push(bpmnModelsRef);
            const modelId = newModelRef.key;

            // Set the BPMN model data
            set(newModelRef, {
                projectId: projectId,
                ownerId: user.uid,
                name: newModelName,
                folder: selectedFolder?.id || null,
                type: 'bpmn',
                xmlData: `<?xml version="1.0" encoding="UTF-8"?>
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
                            </bpmn:definitions>`,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }).then(() => {
                const updates = {};
                updates['/projects/' + projectId + '/models/' + modelId] = true;

                update(ref(db), updates).then(() => {
                    toastr.success('New BPMN model added successfully');
                    fetchUserProjects(user.uid);
                }).catch((error) => {
                    toastr.error('Error adding new BPMN model: ', error);
                });
            })
        }
    };

    const handleAddDMNModel = (projectId, newModelName) => {
        if (newModelName) {
            const db = getDatabase();
            const bpmnModelsRef = ref(db, 'bpmnModels');

            // Generate a new model ID
            const newModelRef = push(bpmnModelsRef);
            const modelId = newModelRef.key;

            // Set the BPMN model data
            set(newModelRef, {
                projectId: projectId,
                ownerId: user.uid,
                name: newModelName,
                type: 'dmn',
                folder: selectedFolder?.id || null,
                xmlData: `<?xml version="1.0" encoding="UTF-8"?>
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
                            </definitions>`,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }).then(() => {
                const updates = {};
                updates['/projects/' + projectId + '/models/' + modelId] = true;

                update(ref(db), updates).then(() => {
                    toastr.success('New DMN model added successfully');
                    fetchUserProjects(user.uid);
                }).catch((error) => {
                    toastr.error('Error adding new DMN model: ', error);
                });
            })
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
                fetchUserProjects(user.uid);
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

    const handleRenameModel = (newModelName) => {
        const db = getDatabase();
        const modelRef = ref(db, `bpmnModels/${selectedModel.id}`);

        update(modelRef, {name: newModelName})
            .then(() => {
                fetchUserProjects(user.uid);
                toastr.success("Model name updated successfully");
            })
            .catch((error) => toastr.error("Error updating model name: ", error));
    }

    const handleRenameFolder = (projectId, newFolderName) => {
        const db = getDatabase();
        const projectFoldersRef = ref(db, `/projects/${projectId}/folders/${selectedModel.id}`);
        console.log('projectFoldersRef: ', projectFoldersRef);


        update(projectFoldersRef, {name: newFolderName})
            .then(() => {
                fetchUserProjects(user.uid);
                toastr.success("Folder name updated successfully");
            })
            .catch((error) => toastr.error("Error updating model name: ", error));
    }

    const handleMoveModel = (newFolderId) => {
        const db = getDatabase();
        const modelRef = ref(db, `bpmnModels/${selectedModel.id}`);

        update(modelRef, {folder: newFolderId || null})
            .then(() => {
                fetchUserProjects(user.uid);
                toastr.success("Model moved successfully");
            })
            .catch((error) => toastr.error("Error moving model: ", error));
    }

    const handleDuplicateModel = (model) => {
        if (model) {
            const db = getDatabase();
            const bpmnModelsRef = ref(db, 'bpmnModels');

            // Generate a new model ID
            const newModelRef = push(bpmnModelsRef);
            const modelId = newModelRef.key;

            // Set the BPMN model data
            set(newModelRef, {
                projectId: model.projectId,
                ownerId: user.uid,
                name: `${model.name} Copy`,
                type: model.type,
                xmlData: model.xmlData,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }).then(() => {
                const updates = {};
                updates['/projects/' + model.projectId + '/models/' + modelId] = true;

                update(ref(db), updates).then(() => {
                    toastr.success('Model duplicated successfully');
                    fetchUserProjects(user.uid);
                }).catch((error) => {
                    toastr.error('Error duplicating model: ', error);
                });
            })
        }
    };

    const handleFileChange = (event: ChangeEvent<HTMLInputElement>, projectId: string) => {
        const file = event.target.files?.[0];

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
    };

    const handleUploadBPMNModel = (projectId: string, xml: string, filename) => {
        if (xml) {
            const db = getDatabase();
            const bpmnModelsRef = ref(db, 'bpmnModels');

            // Generate a new model ID
            const newModelRef = push(bpmnModelsRef);
            const modelId = newModelRef.key;

            // Set the BPMN model data
            set(newModelRef, {
                projectId: projectId,
                ownerId: user.uid,
                name: extractBpmnProcessName(xml) || filename.replace('.bpmn',''),
                type: 'bpmn',
                folder: selectedFolder?.id || null,
                xmlData: xml,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }).then(() => {
                const updates = {};
                updates['/projects/' + projectId + '/models/' + modelId] = true;

                update(ref(db), updates).then(() => {
                    toastr.success('New BPMN model added successfully');
                    fileInputRef.current.value = '';
                    fetchUserProjects(user.uid);
                }).catch((error) => {
                    toastr.error('Error adding new BPMN model: ', error);
                });
            })
        }
    };

    const handleUploadDMNModel = (projectId: string, xml: string, filename) => {
        if (xml) {
            const db = getDatabase();
            const bpmnModelsRef = ref(db, 'bpmnModels');

            // Generate a new model ID
            const newModelRef = push(bpmnModelsRef);
            const modelId = newModelRef.key;
            
            // Set the DMN model data
            set(newModelRef, {
                projectId: projectId,
                ownerId: user.uid,
                name: extractDmnTableName(xml) || filename.replace('.bpmn',''),
                type: 'dmn',
                xmlData: xml,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }).then(() => {
                const updates = {};
                updates['/projects/' + projectId + '/models/' + modelId] = true;

                update(ref(db), updates).then(() => {
                    toastr.success('New DMN model added successfully');
                    fileInputRef.current.value = '';
                    fetchUserProjects(user.uid);
                }).catch((error) => {
                    toastr.error('Error adding new DMN model: ', error);
                });
            })
        }
    };

    const handleUploadButtonClick = () => {
        fileInputRef.current.click();
    };

    const fetchUserProjects = async (userId) => {
        const db = getDatabase();
        const userProjectsRef = ref(db, `users/${userId}/projects`);

        const userProjectsSnapshot = await get(userProjectsRef);
        if (userProjectsSnapshot.exists()) {
            const userProjectsIds = Object.keys(userProjectsSnapshot.val());
            const bpmnModelsSnapshot = await get(ref(db, 'bpmnModels'));
            const usersSnapshot = await get(ref(db, 'users'));

            const bpmnModelsData = bpmnModelsSnapshot.exists() ? bpmnModelsSnapshot.val() : {};
            const usersData = usersSnapshot.exists() ? usersSnapshot.val() : {};

            const projectsPromises = userProjectsIds.map((projectId) => get(ref(db, `projects/${projectId}`)));
            const projectsSnapshots = await Promise.all(projectsPromises);
            const userProjects = projectsSnapshots
                .filter((snapshot) => snapshot.exists())
                .map((snapshot) => {
                    // const projectModelsIds = Object.keys(snapshot.val().models);
                    // const projectModelsPromises = projectModelsIds.map((modelId) => get(ref(db, `bpmnModels/${modelId}`)));
                    // const projectModelsSnapshots = await Promise.all(projectModelsPromises);
                    // console.log('projectModelsSnapshots: ', projectModelsSnapshots);
                    const projectId = snapshot.key;
                    const projectData = snapshot.val();
                    const projectModels = Object.keys(bpmnModelsData)
                        .filter(modelId => bpmnModelsData[modelId].projectId === projectId)
                        .map(modelId => ({
                            id: modelId,
                            ...bpmnModelsData[modelId]
                        }));

                    const projectFolders = Object.keys(projectData?.folders ?? {}).map(folderId => ({
                        id: folderId, 
                        name: projectData.folders[folderId].name,
                        type: 'folder',
                        owner: '',
                        date: undefined,
                        actions: undefined
                    }));

                    const projectMembers = Object.keys(projectData.members).map(memberId => ({
                        id: memberId,
                        role: projectData.members[memberId],
                        displayName: usersData[memberId]?.displayName || '',
                        email: usersData[memberId]?.email || '',
                        imageUrl: usersData[memberId]?.imageUrl || 'user.png'
                    }));

                    return {
                        id: projectId,
                        ...projectData,
                        models: projectModels,
                        folders: projectFolders,
                        members: projectMembers
                    };
                });

            setProjects(userProjects);
        } else {
            setProjects([]);
        }
    };

    const fetchInvites = async () => {
        const db = getDatabase();
        const invitationsRef = ref(db, 'invitations');
        const usersRef = ref(db, 'users');
        const projectsRef = ref(db, 'projects');
        const invitationsQuery = query(invitationsRef, orderByChild('invitedEmail'), equalTo(user.email));

        try {
            const [invitationsSnapshot, usersSnapshot, projectsSnapshot] = await Promise.all([
                get(invitationsQuery),
                get(usersRef),
                get(projectsRef)
            ]);

            if (invitationsSnapshot.exists()) {
                const invitationsData = invitationsSnapshot.val();
                const usersData = usersSnapshot.exists() ? usersSnapshot.val() : {};
                const projectsData = projectsSnapshot.exists() ? projectsSnapshot.val() : {};

                const invitationsList = Object.keys(invitationsData).map((key) => {
                    const invitation = invitationsData[key];
                    return {
                        id: key,
                        ...invitation,
                        senderName: usersData[invitation.senderId]?.displayName || 'Unknown',
                        senderEmail: usersData[invitation.senderId]?.email || 'Unknown',
                        projectName: projectsData[invitation.projectId]?.name || 'Unknown'
                    };
                });

                setInvitations(invitationsList);
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
        const modelRef = ref(db, `bpmnModels/${modelId}`);
        const projectModelRef = ref(db, `projects/${currentProject.id}/models/${modelId}`);

        remove(projectModelRef);

        remove(modelRef).then(() => {
            toastr.success('Model deleted successfully');
            fetchUserProjects(user.uid);
            setIsConfirmModalOpen(false);
        }).catch((error) => {
            toastr.error('Error deleting model: ', error);
        });
    }

    const onDeleteProject = () => {
        const db = getDatabase();
        const modelRef = ref(db, `projects/${currentProject.id}`);

        remove(modelRef).then(() => {
            deleteModelsAndInvites(currentProject.id);
            toastr.success('Project deleted successfully');
            fetchUserProjects(user.uid);
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
            toastr.success('Folder deleted successfully');
            fetchUserProjects(user.uid);
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

        update(ref(db), updates).then(() => {
            toastr.success('Invitation accepted and user added to project');
            setIsInviteModalOpen(false);
            fetchInvites();
            fetchUserProjects(userId);
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
            fetchUserProjects(user.uid);
            setIsConfirmModalOpen(false);
            toastr.success(`Member removed from project successfully`);
        }).catch((error) => {
            toastr.error('Error removing member:', error);
        });
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
                                Projects
                            </Heading>
                        </div>
                        <br/><br/>
                        <DataTable
                            rows={sortRows([...projects], sortHeader, sortDirection).map(project => ({
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
                                {key: 'actions', header: 'Options'},
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
                                                    <TableCell colSpan={headers.length}>
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
                                                {headers.map(header => (
                                                    <TableHeader
                                                        {...getHeaderProps({
                                                            header,
                                                            isSortable: true,
                                                            onClick: () => {
                                                                const newDirection = sortDirection === 'ASC' ? 'DESC' : 'ASC';
                                                                setSortHeader(header.key);
                                                                setSortDirection(sortDirection === 'NONE' || header.key !== sortHeader ? 'ASC' : newDirection);
                                                            },
                                                        })}
                                                    >
                                                        {header.header}
                                                    </TableHeader>
                                                ))}
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {rows.map(row => (
                                                <TableRow {...getRowProps({row})}
                                                          onClick={() => onOpenProject(projects.filter((project) => project.id === row.id)[0])}>
                                                    {row.cells.map(cell => (
                                                        <TableCell key={cell.id}>
                                                            {cell.info.header === 'members' ? (
                                                                renderMembersCell(cell.value) // Use the rendering function for the members cell
                                                            ) : cell.info.header === 'actions' && cell.value ? (
                                                                <OverflowMenu flipped>
                                                                    <OverflowMenuItem
                                                                        itemText="Delete Project"
                                                                        isDelete
                                                                        onClick={(e) => {
                                                                            e.stopPropagation(); // Prevent triggering row onClick
                                                                            openConfirmModal(
                                                                                `Are you sure you want to delete project '${row.cells[0].value}'?`,
                                                                                () => onDeleteProject(cell.value)
                                                                            );
                                                                        }}
                                                                    />
                                                                    {/* Add more actions here as <OverflowMenuItem> */}
                                                                </OverflowMenu>
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
                                            ))}
                                        </TableBody>
                                    </Table>
                                </TableContainer>
                            )}
                        />
                    </>
                )}
                {viewMode === 'PROJECT' && currentProject &&
                    <>
                        <div className="project-heading">
                            <Heading>
                                {currentProject.name}
                            </Heading>
                            {currentProject.ownerId === user.uid && (
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
                            )}
                        </div>
                        <br/><br/>
                        <div className="project-wrapper">
                            <div className="project-models-wrapper">
                                <DataTable
                                    rows={sortRows([{'type': 'folderUp', 'id': 'folderUp', 'name': '..', 'folder': ''}, ...currentProject?.folders, ...currentProject.models], sortHeaderModels, sortDirectionModels)
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
                                    render={({rows, headers, getHeaderProps}) => (
                                        <TableContainer title="Models">
                                            <TableToolbar>
                                                <TableToolbarContent>
                                                    <div className="cds--toolbar-title">
                                                        Models
                                                    </div>
                                                    <input style={{display: 'none'}} type="file" accept=".bpmn, .dmn"
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
                                                            <TableCell colSpan={headers.length}>
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
                                                                        <input style={{display: 'none'}} type="file" accept=".bpmn, .dmn"
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
                                                        {headers.map(header => (
                                                            <TableHeader key={header.key} {...getHeaderProps({
                                                                header,
                                                                isSortable: true,
                                                                onClick: () => {
                                                                    const newDirection = sortDirection === 'ASC' ? 'DESC' : 'ASC';
                                                                    setSortHeaderModels(header.key);
                                                                    setSortDirectionModels(sortDirection === 'NONE' || header.key !== sortHeader ? 'ASC' : newDirection);
                                                                },
                                                            })}>
                                                                {header.header}
                                                            </TableHeader>
                                                        ))}
                                                    </TableRow>
                                                </TableHead>
                                                <TableBody>
                                                    {rows.map(row => {
                                                        const model = [{'type': 'folderUp', 'id': 'folderUp', 'name': '..'}, ...currentProject.folders, ...currentProject.models].filter(
                                                            (model) => model.id === row.id
                                                        )[0];
                                                        // console.log('model: ', model);
                                                        return (
                                                            <TableRow key={row.id}
                                                                      onClick={() => onOpenModel(currentProject, model)}
                                                                      style={model?.type === 'dmn' ? { cursor: 'not-allowed' } : { }}>
                                                                {row.cells.map((cell) => <TableCell key={cell.id}>
                                                                        {cell.info.header === 'actions' ? (
                                                                            <OverflowMenu flipped>
                                                                                {(model?.type === 'bpmn' || model?.type === 'dmn') &&<OverflowMenuItem
                                                                                    itemText="Download"
                                                                                    onClick={(e) => {
                                                                                        e.stopPropagation();
                                                                                        downloadXmlAsBpmn(model);
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
                                                                                            <FolderParent className="project-name-icon"/>} {cell.value}
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
                                    )}
                                />
                            </div>
                            {!isMembersPanelOpen && (
                                <Button
                                    className="open-members-panel-button"
                                    onClick={() => setIsMembersPanelOpen(true)}
                                    hasIconOnly
                                    renderIcon={Group}
                                    iconDescription="Open members panel"
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
                                                        <Button hasIconOnly kind="ghost" renderIcon={Close} iconDescription="Close members panel" tooltipPosition="top" onClick={() => setIsMembersPanelOpen(false)} />
                                                    </TableToolbarContent>
                                                </TableToolbar>
                                                <Table>
                                                    <TableHead>
                                                        <TableRow>
                                                            {headers.map((header) => (
                                                                <TableHeader {...getHeaderProps({header})}>
                                                                    {header.header}
                                                                </TableHeader>
                                                            ))}
                                                        </TableRow>
                                                    </TableHead>
                                                    <TableBody>
                                                        {rows.map((row) => (
                                                            <TableRow key={row.id} {...getRowProps({row})}>
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
                                                        ))}
                                                    </TableBody>
                                                    {rows.length === 1 && (
                                                        <TableBody>
                                                            <TableRow>
                                                                <TableCell colSpan={headers.length}>
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
                            };
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
                onClose={() => setIsMoveModelModalOpen(false)}
                onMoveModel={handleMoveModel}
                folders={currentProject?.folders || []}
                currentFolderId={selectedModel?.folder}
            />

            <InviteModal
                isOpen={isInviteModalOpen}
                onClose={() => setIsInviteModalOpen(false)}
                projectId={selectedProjectId}
                userId={user.uid}
            />
        </div>
    )
        ;
};

export default ProjectList;
