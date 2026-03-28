import './App.css'
import BPMNModelerComponent from "./components/BpmnModeler.tsx";
import {auth} from './config/.firebase.js';
import {saveBPMNModel, saveDMNodel} from './services/models.service.tsx'
import {signInWithGoogle, signInWithMicrosoft, logout} from './services/user.service.tsx';
import { onAuthStateChanged } from 'firebase/auth';
import React, { useEffect, useState, useRef, useCallback } from "react";
import ProjectList from "./components/ProjectList.tsx";
import SaveModal from "./components/SaveModal.tsx";
import LogoutModal from "./components/LogoutModal.tsx";
import DMNModelerComponent from "./components/DmnModeler.tsx";
import toastr from 'toastr';
import {Button, OverflowMenu, OverflowMenuItem, Toggle, Tile} from '@carbon/react';
import {Save, Login, Download, Image as PNG, OpenPanelLeft, Folder, DecisionTree, TableSplit, FolderParent, RightPanelOpen, SidePanelOpen, SidePanelClose, Share, Flag} from '@carbon/react/icons';
import { child, get, getDatabase, ref, set, query, orderByChild, equalTo } from 'firebase/database';
import { FaGoogle, FaMicrosoft } from 'react-icons/fa';
import config from './config/config';
import {downloadXmlAsBpmn} from './services/utils.service.tsx';
import { useNavigate, useLocation } from 'react-router-dom';
import ShareModal from "./components/ShareModal.tsx";
import MilestonesModal from "./components/MilestonesModal.tsx";


function App() {
    const [user, setUser] = useState(null);
    const [projects, setProjects] = useState([]);
    const [isProjectsLoaded, setIsProjectsLoaded] = useState(false);
    const [model, setModel] = useState({});
    const [autoSave, setAutoSave] = useState(() => {
        const saved = localStorage.getItem('autoSave');
        return saved ? JSON.parse(saved) : false;
    });
    const [project, setProject] = useState({});
    const [folder, setfolder] = useState({});
    const [viewMode, setViewMode] = useState('INITIALIZING');
    const [changes, setChanges] = useState(false);
    const [viewPosition, setViewPosition] = useState(null);
    const [isProjectViewerOpen, setIsProjectViewerOpen] = useState(() => {
        const saved = localStorage.getItem('isProjectViewerOpen');
        return saved ? JSON.parse(saved) : false;
    });
    const [sidePanelWidth, setSidePanelWidth] = useState(() => {
        const saved = localStorage.getItem('sidePanelWidth');
        return saved ? parseInt(saved, 10) : 250;
    });
    const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
    const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);
    const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
    const [isShareModalOpen, setIsShareModalOpen] = useState(false);
    const [isMilestonesModalOpen, setIsMilestonesModalOpen] = useState(false);
    const [shareUrl, setShareUrl] = useState('');
    const [userAvatar, setUserAvatar] = useState('user.png');
    const bpmnModelerRef = useRef(null);
    const dmnModelerRef = useRef(null);
    const [isLoadingXml, setIsLoadingXml] = useState(false);
    const loadingTimeoutRef = useRef(null);

    const navigate = useNavigate();
    const location = useLocation();

    const autoSaveRef = useRef(autoSave);
    const modelRef = useRef(model);
    const projectRef = useRef(project);
    const folderRef = useRef(folder);
    const fetchingModelIdRef = useRef(null);
    const isResizingRef = useRef(false);

    useEffect(() => {
        autoSaveRef.current = autoSave;
        localStorage.setItem('autoSave', JSON.stringify(autoSave));
    }, [autoSave]);

    useEffect(() => {
        modelRef.current = model;
    }, [model]);

    useEffect(() => {
        projectRef.current = project;
    }, [project]);

    useEffect(() => {
        folderRef.current = folder;
    }, [folder]);

    useEffect(() => {
        localStorage.setItem('isProjectViewerOpen', JSON.stringify(isProjectViewerOpen));
    }, [isProjectViewerOpen]);

    useEffect(() => {
        localStorage.setItem('sidePanelWidth', sidePanelWidth.toString());
    }, [sidePanelWidth]);

    const startResizing = useCallback(() => {
        isResizingRef.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    }, []);

    const stopResizing = useCallback(() => {
        isResizingRef.current = false;
        document.body.style.cursor = 'default';
        document.body.style.userSelect = 'auto';
    }, []);

    const resize = useCallback((mouseMoveEvent) => {
        if (isResizingRef.current) {
            const newWidth = mouseMoveEvent.clientX;
            if (newWidth > 150 && newWidth < 800) {
                setSidePanelWidth(newWidth);
            }
        }
    }, []);

    useEffect(() => {
        setTimeout(() => {
            if (viewMode === 'BPMN' && bpmnModelerRef.current) {
                bpmnModelerRef.current.handleResize();
            }
            if (viewMode === 'DMN' && dmnModelerRef.current) {
                dmnModelerRef.current.handleResize();
            }
        }, 100);
    }, [isProjectViewerOpen, viewMode]);

    useEffect(() => {
        window.addEventListener("mousemove", resize);
        window.addEventListener("mouseup", stopResizing);
        return () => {
            window.removeEventListener("mousemove", resize);
            window.removeEventListener("mouseup", stopResizing);
        };
    }, [resize, stopResizing]);

    toastr.options = {
        closeButton: false,
        debug: false,
        newestOnTop: false,
        progressBar: false,
        positionClass: 'toast-bottom-full-width',
        preventDuplicates: false,
        onclick: null,
        showDuration: '200',
        hideDuration: '600',
        timeOut: '2500',
        extendedTimeOut: '1000',
        showEasing: 'swing',
        hideEasing: 'linear',
        showMethod: 'fadeIn',
        hideMethod: 'fadeOut',
    };

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user) {
                // User is signed in, see docs for a list of available properties
                // https://firebase.google.com/docs/reference/js/firebase.User
                setUser(user);

                // Fetch user avatar from the database
                const db = getDatabase();
                const userRef = ref(db, 'users/' + user.uid);
                const snapshot = await get(child(userRef, '/'));
                if (snapshot.exists()) {
                    const userData = snapshot.val();
                    setUserAvatar(userData.imageUrl || 'user.png');
                }
                
                fetchUserProjects(user.uid);
            } else {
                // User is signed out
                setUser(null);
                setProjects([]);
                setIsProjectsLoaded(false);
            }
        });

        // Cleanup subscription on unmount
        return () => unsubscribe();
    }, []);

    const fetchUserProjects = useCallback(async (userId) => {
        if (!userId) return;
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
        setIsProjectsLoaded(true);
    }, []);

    // Sync URL with Application State
    useEffect(() => {
        if (!user || !isProjectsLoaded) return;

        const path = location.pathname;
        if (path === '/' || path === '') {
            if (viewMode !== 'ALL_PROJECTS') {
                setProject({}); setfolder({}); setModel({}); setViewMode('ALL_PROJECTS');
            }
            return;
        }

        const projectMatch = path.match(/^\/project\/([^\/]+)/);
        if (projectMatch) {
            const decodedProjectName = decodeURIComponent(projectMatch[1]);
            const p = projects.find(p => p.name === decodedProjectName);
            
            if (!p) {
                if (viewMode !== '404') setViewMode('404');
                return;
            }

            if (projectRef.current?.id !== p.id) setProject(p);

            const folderMatch = path.match(/^\/project\/[^\/]+\/folder\/([^\/]+)/);
            const modelMatch = path.match(/^\/project\/[^\/]+\/model\/([^\/]+)/);

            if (folderMatch) {
                const decodedFolderName = decodeURIComponent(folderMatch[1]);
                const f = p.folders?.find(f => f.name === decodedFolderName);
                if (f) {
                    if (folderRef.current?.id !== f.id) setfolder(f);
                    if (modelRef.current?.id) setModel({});
                    if (viewMode !== 'BPMN' && viewMode !== 'DMN') {
                        if (viewMode !== 'PROJECT') setViewMode('PROJECT');
                    }
                } else {
                    if (viewMode !== '404') setViewMode('404');
                }
            } else if (modelMatch) {
                const modelId = modelMatch[1];
                const m = p.models?.find(m => m.id === modelId);
                
                if (m) {
                    if (m.folder) {
                        const f = p.folders?.find(folder => folder.id === m.folder);
                        if (f && folderRef.current?.id !== f.id) setfolder(f);
                    } else if (folderRef.current?.id) {
                        setfolder({});
                    }

                    if (modelRef.current?.id !== modelId && fetchingModelIdRef.current !== modelId) {
                        fetchingModelIdRef.current = modelId;
                        setViewMode(m.type === 'bpmn' ? 'BPMN' : 'DMN');

                        // Only show loading indicator if loading takes more than 200ms
                        loadingTimeoutRef.current = setTimeout(() => setIsLoadingXml(true), 200);
                        
                        const db = getDatabase();
                        get(ref(db, `modelXmlData/${modelId}`)).then(xmlDataSnapshot => {
                            if (xmlDataSnapshot.exists()) {
                                const modelWithXml = {
                                    ...m,
                                    xmlData: xmlDataSnapshot.val().xmlData
                                };
                                setModel(modelWithXml);
                                setViewPosition(null);
                            } else {
                                toastr.error('Could not load model data.');
                                setViewMode('404');
                            }
                        }).catch(err => {
                            console.error(err);
                            setViewMode('404');
                        }).finally(() => {
                            clearTimeout(loadingTimeoutRef.current);
                            setIsLoadingXml(false);
                            fetchingModelIdRef.current = null;
                        });
                    } else if (modelRef.current?.id === modelId) {
                        if (viewMode !== (m.type === 'bpmn' ? 'BPMN' : 'DMN')) setViewMode(m.type === 'bpmn' ? 'BPMN' : 'DMN');
                    }
                } else {
                    if (viewMode !== '404') setViewMode('404');
                }
            } else {
                if (folderRef.current?.id) setfolder({});
                if (modelRef.current?.id) setModel({});
                if (viewMode !== 'BPMN' && viewMode !== 'DMN') {
                    if (viewMode !== 'PROJECT') setViewMode('PROJECT');
                }
            }
        } else {
            if (viewMode !== '404') setViewMode('404');
        }
    }, [location.pathname, isProjectsLoaded, projects, user]);

    const handleNavigation = (path: string) => {
        if (changes) {
            setPendingNavigation(path);
            setIsSaveModalOpen(true);
        } else {
            navigate(path);
        }
    };

    const handleOpenShareModal = () => {
        setShareUrl(window.location.href);
        setIsShareModalOpen(true);
    };

    const onSaveModelClick = (model) => {
        saveBPMNModel(model).then(() => fetchUserProjects(user.uid));
        setChanges(false);
    };

    const onSaveDMNClick = (model) => {
        saveDMNodel(model).then(() => fetchUserProjects(user.uid));
        setChanges(false);
    };

    const handleOpenProject = (project) => {
        if (project){
            handleNavigation('/project/' + encodeURIComponent(project.name));
        }
    };

    const handleOpenModel = (project, model) => {
        //TODO: remove if statement if DMN is supported
        if (model?.type === 'bpmn' || model?.type === 'dmn') {
            handleNavigation('/project/' + encodeURIComponent(project.name) + '/model/' + model.id);
        } else if (model?.type === 'folder') {
            handleNavigation('/project/' + encodeURIComponent(project.name) + '/folder/' + encodeURIComponent(model.name));
        } else if (model?.type === 'folderUp') {
            handleNavigation('/project/' + encodeURIComponent(project.name));
        }
    };

    const handleModelChange = useCallback((newXml) => {
        setChanges(true);
        const updatedModel = {
            ...modelRef.current,
            xmlData: newXml
        };
        setModel(updatedModel);
        if (autoSaveRef.current) {
            saveBPMNModel(updatedModel).then(() => {
                if (projectRef.current?.id) {
                    fetchUserProjects(user.uid);
                }
            });
            setChanges(false);
        }
    }, [fetchUserProjects]);

    const handleViewPositionChange = (viewbox) => {
        setViewPosition(viewbox);
    }

    const onMyProjectsNavClick = () => {
        handleNavigation('/');
    }

    const onCurrentProjectNavClick = () => {
        handleNavigation('/project/' + encodeURIComponent(project.name));
    }

    const onCurrentFolderNavClick = () => {
        handleNavigation('/project/' + encodeURIComponent(project.name) + '/folder/' + encodeURIComponent(folder.name));
    }

    const handleOnSave = (model) => {
        saveBPMNModel(model);
        setChanges(false);
        setIsSaveModalOpen(false);
        if (pendingNavigation) {
            navigate(pendingNavigation);
            setPendingNavigation(null);
        }
    }

    const handleOnDiscard = () => {
        setChanges(false);
        setIsSaveModalOpen(false);
        if (pendingNavigation) {
            navigate(pendingNavigation);
            setPendingNavigation(null);
        }
    }

    const onLogoutClick = () => {
        setIsLogoutModalOpen(true);
    }

    const handleOnSaveLogout = (model) => {
        if (model.type === 'bpmn') {
            saveBPMNModel(model);
        } else if (model.type === 'dmn') {
            saveDMNodel(model);
        }
        setModel({});
        setProject({});
        setViewMode('ALL_PROJECTS');
        logout();
        setIsLogoutModalOpen(false);
        navigate('/');
    }

    const handleOnDiscardLogout = () => {
        setModel({});
        setProject({});
        setViewMode('ALL_PROJECTS');
        logout();
        setIsLogoutModalOpen(false);
        navigate('/');
    }

    const handleCloseLogout = () => {
        setIsLogoutModalOpen(false);
    }

    const handleNavigateHome = () => {
        handleNavigation('/');
    }

    const onDownloadAsPng = async () => {
        if (bpmnModelerRef.current) {
            try {
                const { svg } = await bpmnModelerRef.current.saveSVG();
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                const image = new Image();

                image.onload = () => {
                    canvas.width = image.width * 1.5;
                    canvas.height = image.height * 1.5;
                    context.drawImage(image, 0, 0, image.width * 1.5, image.height * 1.5);

                    const pngUrl = canvas.toDataURL('image/png');
                    const link = document.createElement('a');
                    link.download = `${model.name || 'diagram'}.png`; // TODO: Implement versioning in file name
                    link.href = pngUrl;
                    link.click();
                };
                image.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
            } catch (err) {
                toastr.error('Could not save BPMN diagram as PNG.', err);
            }
        }
    };

    const getSidePanelItems = () => {
        if (!project || !project.models) return [];

        const currentFolderId = folder.id || null;
        let items = [];

        if (currentFolderId) {
            items.push({ type: 'folderUp', name: '.. / ' + folder.name || '', id: 'up' });
        } else {
            const folders = (project.folders || []).map(f => ({ ...f, type: 'folder' }));
            items = [...items, ...folders];
        }

        const models = (project.models || [])
            .filter(m => m.folder === currentFolderId || (!m.folder && !currentFolderId));

        items = [...items, ...models];

        return items.sort((a, b) => {
            if (a.type === 'folderUp') return -1;
            if (b.type === 'folderUp') return 1;
            if (a.type === 'folder' && b.type !== 'folder') return -1;
            if (a.type !== 'folder' && b.type === 'folder') return 1;
            return (a.name || '').localeCompare(b.name || '');
        });
    };

    const handleSidePanelItemClick = async (item) => {
        if (item.id === model.id) return;

        if (item.type === 'dmn') return;

        if (changes) {
            toastr.warning("You have unsaved changes. Please save them before switching models.");
            return;
        }

        let path = '';
        if (item.type === 'folder' || item.type === 'folderUp') {
            if (item.type === 'folderUp') {
                path = '/project/' + encodeURIComponent(project.name);
            } else {
                path = '/project/' + encodeURIComponent(project.name) + '/folder/' + encodeURIComponent(item.name);
            }
        } else {
            path = '/project/' + encodeURIComponent(project.name) + '/model/' + item.id;
        }
        handleNavigation(path);
    };

    return (
      <div className="App">
          {model && <SaveModal
              isOpen={isSaveModalOpen}
              onSave={() => handleOnSave(model)}
              onDiscard={handleOnDiscard}
          />}
          {model && <LogoutModal
              isOpen={isLogoutModalOpen}
              onSaveAndLogout={() => handleOnSaveLogout(model)}
              onLogout={handleOnDiscardLogout}
              onClose={handleCloseLogout}
              changes={changes}
          />}
          <ShareModal
              isOpen={isShareModalOpen}
              onClose={() => setIsShareModalOpen(false)}
              url={shareUrl}
          />
          <MilestonesModal
              isOpen={isMilestonesModalOpen}
              onClose={() => setIsMilestonesModalOpen(false)}
              model={model}
              user={user}
              changes={changes}
              onLoadMilestone={(xml) => {
                  if (viewMode === 'BPMN' && bpmnModelerRef.current) {
                      bpmnModelerRef.current.importXML(xml).then(() => handleModelChange(xml));
                  } else if (viewMode === 'DMN' && dmnModelerRef.current) {
                      dmnModelerRef.current.importXML(xml).then(() => handleModelChange(xml));
                  }
              }}
          />
          <Tile className="header">
              <div className="header-logo">
                  <img src="/bpmn_modeler_logo.png" alt="valtimo academy logo"/>
              </div>
              <div className="header-nav">
                  {user && <div className="nav-projects-folder" onClick={onMyProjectsNavClick}>
                      Projects
                  </div>}
                  {project.name && <div>
                      &#8594;
                  </div>}
                  {project.name && <div className="nav-project" onClick={onCurrentProjectNavClick}>
                      {project.name}
                  </div>}
                  {folder.name && <div>
                      &#8594;
                  </div>}
                  {folder.name && <div className="nav-project" onClick={onCurrentFolderNavClick}>
                      {folder.name}
                  </div>}
                  {model.name && <div>
                      &#8594;
                  </div>}
                  {model.name && <div className="nav-model">
                      {model.name}
                  </div>}
              </div>
              <div className="header-user">
                  {!user &&
                    <div className="header-user-sign-in">
                      {config.enableGoogleSignIn && (
                        <Button size="sm" onClick={signInWithGoogle}><FaGoogle className="project-name-icon"/>Sign in with Google</Button>
                      )}
                      {config.enableMicrosoftSignIn && (
                        <Button size="sm" onClick={signInWithMicrosoft}><FaMicrosoft className="project-name-icon"/>Sign in with Microsoft</Button>
                      )}
                    </div>
                  }
                  {user &&
                      <div className="header-user-signed-in">
                          <img src={userAvatar} alt="user-avatar" style={{
                              width: '32px',
                              height: '32px',
                              borderRadius: '16px'
                          }}/>
                          Welcome, {user.displayName}
                          <OverflowMenu flipped>
                              <OverflowMenuItem
                                  itemText="Logout"
                                  isDelete
                                  onClick={(e) => {
                                      e.stopPropagation();
                                      onLogoutClick();
                                  }}
                              />
                          </OverflowMenu>
                      </div>
                  }
              </div>
          </Tile>
          {(viewMode === 'BPMN' || viewMode === 'DMN') && user ? (
              <div style={{ display: 'flex', width: '100%', overflow: 'hidden' }}>
                  <div style={{
                      width: isProjectViewerOpen ? `${sidePanelWidth}px` : '0px',
                      minWidth: isProjectViewerOpen ? `${sidePanelWidth}px` : '0px',
                      maxHeight: 'calc(100vh - 64px)',
                      borderRight: isProjectViewerOpen ? '2px solid #e0e0e0' : '0px solid #e0e0e0',
                      backgroundColor: '#efefef',
                      zIndex: 900,
                      position: 'relative',
                      display: 'flex',
                      flexDirection: 'column',
                      transition: 'width 0.2s ease-in-out, min-width 0.2s ease-in-out',
                      overflow: 'hidden'
                  }}>
                    <div style={{ height: '2px', width: '100%', backgroundColor: '#e0e0e0', flexShrink: 0 }}></div>
                    <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
                      {getSidePanelItems().map(item => (
                          <div
                              key={item.id}
                              onClick={() => handleSidePanelItemClick(item)}
                              style={{
                                  cursor: item.type === 'dmn' ? 'not-allowed' : 'pointer',
                                  padding: '0.5rem 1rem',
                                  display: 'flex',
                                  alignItems: 'center',
                                  backgroundColor: (model.id === item.id || folder.id === item.id) ? '#e0e0e0' : 'transparent',
                                  borderBottom: '2px solid #e0e0e0',
                                  color: '#161616'
                              }}
                              title={item.name}
                          >
                              {item.type === 'folder' && <Folder />}
                              {item.type === 'folderUp' && <FolderParent />}
                              {item.type === 'bpmn' && <DecisionTree />}
                              {item.type === 'dmn' && <TableSplit />}
                              <span style={{ marginLeft: '0.5rem', fontSize: '0.875rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {item.type === 'folder' || item.type === 'folderUp' ? <strong>{item.name}</strong> : item.name}
                              </span>
                          </div>
                      ))}
                    </div>
                    <div
                        onMouseDown={startResizing}
                        style={{
                            width: '5px',
                            cursor: 'col-resize',
                            height: '100%',
                            position: 'absolute',
                            right: 0,
                            top: 0,
                            zIndex: 1000
                        }}
                    />
                  </div>
                  <div style={{ flex: 1, position: 'relative', height: '100%', overflow: 'hidden' }}>
                      <div className="modeler-toolbar-background"></div>
                      <div className="modeler-toolbar">
                          <div className="modeler-toolbar-left">
                                <Button
                                    onClick={() => setIsProjectViewerOpen(!isProjectViewerOpen)}
                                    className={isProjectViewerOpen ? "selected" : ""}
                                    hasIconOnly
                                    renderIcon={isProjectViewerOpen ? SidePanelClose : SidePanelOpen}
                                    iconDescription={isProjectViewerOpen ? "Close project panel" : "Open project panel"}
                                    tooltipPosition="right"
                                />
                              {viewMode === 'BPMN' &&
                                  <Button
                                      onClick={() => downloadXmlAsBpmn(model)}
                                      className="download-bpmn-button"
                                      hasIconOnly
                                      renderIcon={Download}
                                      iconDescription="Download BPMN"
                                      tooltipPosition="right"
                                  />}
                              {viewMode === 'BPMN' &&
                                  <Button
                                      onClick={onDownloadAsPng}
                                      className="download-png-button"
                                      hasIconOnly
                                      renderIcon={PNG}
                                      iconDescription="Download as image"
                                      tooltipPosition="right"
                                  />}
                                  <Button
                                      onClick={handleOpenShareModal}
                                      className="share-button"
                                      hasIconOnly
                                      renderIcon={Share}
                                      iconDescription="Share"
                                      tooltipPosition="right"
                                  />
                          </div>
                          <div className="modeler-toolbar-right">
                              {viewMode === 'BPMN' &&
                                  <Toggle
                                      className="auto-save-toggle"
                                      id="auto-save"
                                      labelText="Auto save"
                                      hideLabel={true}
                                      size="sm"
                                      toggled={autoSave}
                                      onToggle={(checked) => {
                                          if (checked) {
                                              saveBPMNModel(model);
                                              setChanges(false);
                                          }
                                          setAutoSave(checked)
                                      }}
                                  />}
                              <div style={{ display: 'flex', gap: 0 }}>
                                  {viewMode === 'BPMN' && changes &&
                                      <Button onClick={() => onSaveModelClick(model)}>
                                          <Save className="project-name-icon"/> Save
                                      </Button>}
                                  {viewMode === 'BPMN' && !changes &&
                                      <Button onClick={() => onSaveModelClick(model)} disabled>
                                          <Save className="project-name-icon"/> Save
                                      </Button>}
                                  {viewMode === 'DMN' &&
                                      <Button onClick={() => onSaveDMNClick(model)}>
                                          <Save className="project-name-icon"/> Save
                                      </Button>}
                                  {(viewMode === 'BPMN' || viewMode === 'DMN') &&
                                      <Button kind="secondary" onClick={() => setIsMilestonesModalOpen(true)}>
                                          <Flag className="project-name-icon"/> Milestones
                                      </Button>
                                  }
                              </div>
                          </div>
                      </div>
                      {isLoadingXml && (
                          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 'calc(100% - 48px)', color: '#8d8d8d' }}>
                              <h2>Loading Model...</h2>
                          </div>
                      )}
                      {viewMode === 'BPMN' && !isLoadingXml && <BPMNModelerComponent key={model.id} ref={bpmnModelerRef} xml={model.xmlData} viewPosition={viewPosition} onModelChange={handleModelChange} onViewPositionChange={handleViewPositionChange}/>}
                      {viewMode === 'DMN' && !isLoadingXml && <DMNModelerComponent key={model.id} ref={dmnModelerRef} xml={model.xmlData} viewPosition={viewPosition} onDMNChange={handleModelChange} onViewPositionChange={handleViewPositionChange}/>}
                  </div>
              </div>
          ) : (
              <>
                  {viewMode === '404' && user && (
                      <div className="welcome-wrapper">
                          <div className="welcome-title">404 - Not Found</div>
                          <div className="welcome-subtitle">The project, folder, or model you are looking for does not exist or you do not have permission to view it.</div>
                          <br/><Button onClick={() => handleNavigation('/')}>Back to Projects</Button>
                      </div>
                  )}
                  {(viewMode === 'ALL_PROJECTS' || viewMode === 'PROJECT') && user && isProjectsLoaded && <ProjectList user={user} viewMode={viewMode} currentProject={project} selectedFolder={folder} onOpenProject={handleOpenProject} onNavigateHome={handleNavigateHome} onOpenModel={handleOpenModel} projects={projects} fetchUserProjects={() => fetchUserProjects(user.uid)} onOpenShareModal={handleOpenShareModal} />}
                  {(viewMode === 'INITIALIZING' || (user && !isProjectsLoaded)) && (
                      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 'calc(100vh - 64px)', width: '100%', color: '#8d8d8d' }}>
                          <h2>Loading...</h2>
                      </div>
                  )}
                  {!user && <div className="welcome-wrapper">
                      <img src="/bpmn_modeler_logo.png" alt="BPMN Modeler logo" className='welcome-logo'/>
                      <div className="welcome-title">
                          Welcome to BPMN Modeler!
                      </div>
                      <div className="welcome-subtitle">
                          the open-source BPMN & DMN modeling collaboration tool
                      </div>
                  </div>}
              </>
          )}
          {(viewMode !== 'BPMN' && viewMode !== 'DMN') && <Tile className="footer">
              Version: {config.bpmnModelerVersion} - powered by <a href="https://www.valtimo.nl" target="valtimo">Valtimo</a>
          </Tile>}
      </div>
    )
}

export default App
