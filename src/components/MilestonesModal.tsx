import React, { useState, useEffect } from 'react';
import { Modal, TextInput, Button, DataTable, TableContainer, Table, TableHead, TableRow, TableHeader, TableBody, TableCell, Pagination, Toggle } from '@carbon/react';
import { saveMilestone, getMilestones, deleteMilestone } from '../services/models.service.tsx';
import { convertDateString } from '../services/utils.service.tsx';
import toastr from 'toastr';
import ConfirmationModal from "./ConfirmationModal.tsx";

const MilestonesModal = ({ isOpen, onClose, model, user, onLoadMilestone, changes }) => {
    const [milestones, setMilestones] = useState([]);
    const [newMilestoneName, setNewMilestoneName] = useState('');
    const [newMilestoneDescription, setNewMilestoneDescription] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [confirmLoadMilestone, setConfirmLoadMilestone] = useState(null);
    const [milestoneToDelete, setMilestoneToDelete] = useState(null);
    const [saveCurrentAsMilestone, setSaveCurrentAsMilestone] = useState(true);
    const pageSize = 10;

    useEffect(() => {
        if (isOpen && model?.id) {
            fetchMilestones();
            setCurrentPage(1);
        } else {
            setNewMilestoneName('');
            setNewMilestoneDescription('');
        }
    }, [isOpen, model]);

    const fetchMilestones = async () => {
        try {
            const data = await getMilestones(model.id);
            setMilestones(data);
        } catch (error) {
            toastr.error('Failed to load milestones');
        }
    };

    const handleSaveMilestone = async () => {
        if (!newMilestoneName.trim()) return;
        setIsLoading(true);
        try {
            await saveMilestone(model.id, newMilestoneName, newMilestoneDescription, model.xmlData, user.uid);
            toastr.success('Milestone saved successfully');
            setNewMilestoneName('');
            setNewMilestoneDescription('');
            fetchMilestones();
        } catch (error) {
            toastr.error('Failed to save milestone');
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeleteMilestone = async () => {
        if (!milestoneToDelete) return;
        try {
            await deleteMilestone(model.id, milestoneToDelete.id);
            toastr.success('Milestone deleted successfully');
            fetchMilestones(); // Refresh list
        } catch (error) {
            toastr.error('Failed to delete milestone');
        } finally {
            setMilestoneToDelete(null);
        }
    };

    const paginatedMilestones = milestones.slice(
        (currentPage - 1) * pageSize,
        currentPage * pageSize
    );

    if (!isOpen) return null;

    if (milestoneToDelete) {
        return (
            <ConfirmationModal
                isOpen={true}
                message={`Are you sure you want to delete the milestone '${milestoneToDelete.name}'? This action cannot be undone.`}
                onClose={() => setMilestoneToDelete(null)}
                onConfirm={handleDeleteMilestone}
            />
        );
    }

    if (confirmLoadMilestone) {
        return (
            <Modal
                danger
                open={true}
                modalHeading="Confirm Load Milestone"
                primaryButtonText="Load Milestone"
                secondaryButtonText="Cancel"
                onRequestClose={() => {
                    setConfirmLoadMilestone(null);
                    setSaveCurrentAsMilestone(true);
                }}
                onRequestSubmit={async () => {
                    if (saveCurrentAsMilestone) {
                        const autoName = `State before loading '${confirmLoadMilestone.name}'`;
                        try {
                            await saveMilestone(model.id, autoName, 'Auto-saved backup', model.xmlData, user.uid);
                            toastr.success('Current state saved as a new milestone');
                        } catch (error) {
                            toastr.error('Failed to backup current state');
                        }
                    }
                    onLoadMilestone(confirmLoadMilestone.xmlData);
                    setConfirmLoadMilestone(null);
                    setSaveCurrentAsMilestone(true);
                    onClose();
                }}>
                <p style={{ marginBottom: '1rem' }}>
                    Loading this milestone will replace your current canvas. If you have auto-save enabled, your model will be overwritten immediately.
                </p>
                <Toggle
                    id="save-current-milestone-toggle"
                    labelText="Backup current state as a new milestone"
                    size="sm"
                    toggled={saveCurrentAsMilestone}
                    onToggle={(checked) => setSaveCurrentAsMilestone(checked)}
                />
            </Modal>
        );
    }

    return (
        <Modal
            open={isOpen}
            modalHeading="Model Milestones"
            passiveModal
            onRequestClose={onClose}
            size="lg"
        >
            <div style={{ marginBottom: '2rem', display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
                <TextInput
                    id="new-milestone-name"
                    labelText="New Milestone Name"
                    placeholder="e.g., v1.0 Final"
                    value={newMilestoneName}
                    onChange={(e) => setNewMilestoneName(e.target.value)}
                    style={{ flexGrow: 1 }}
                />
                <TextInput
                    id="new-milestone-description"
                    labelText="Description (optional)"
                    placeholder="e.g., Added payment gateway"
                    value={newMilestoneDescription}
                    onChange={(e) => setNewMilestoneDescription(e.target.value)}
                    style={{ flexGrow: 2 }}
                />
                <Button onClick={handleSaveMilestone} disabled={!newMilestoneName.trim() || isLoading}>
                    Save Milestone
                </Button>
            </div>

            <DataTable
                rows={paginatedMilestones.map(m => ({
                    id: m.id,
                    name: m.name,
                    description: m.description || '-',
                    date: convertDateString(m.createdAt),
                    load: '',
                    delete: ''
                }))}
                headers={[
                    { key: 'name', header: 'Name' },
                    { key: 'description', header: 'Description' },
                    { key: 'date', header: 'Date Saved' },
                    { key: 'load', header: '' },
                    { key: 'delete', header: '' }
                ]}
                render={({ rows, headers, getHeaderProps, getRowProps }) => (
                    <TableContainer title="Saved Milestones">
                        <Table>
                            <TableHead>
                                <TableRow>
                                    {headers.map((header) => (
                                        <TableHeader key={header.key} {...getHeaderProps({ header })}>
                                            {header.header}
                                        </TableHeader>
                                    ))}
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {rows.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={headers.length} style={{ textAlign: 'center' }}>
                                            No milestones saved yet.
                                        </TableCell>
                                    </TableRow>
                                )}
                                {rows.map((row) => (
                                    <TableRow key={row.id} {...getRowProps({ row })}>
                                        {row.cells.map((cell) => (
                                            <TableCell key={cell.id}>
                                                {cell.info.header === 'load' ? (
                                                    <Button
                                                        size="sm"
                                                        kind="ghost"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            const milestoneToLoad = milestones.find(m => m.id === row.id);
                                                            if (milestoneToLoad) setConfirmLoadMilestone(milestoneToLoad);
                                                        }}
                                                    >
                                                        Load
                                                    </Button>
                                                ) : cell.info.header === 'delete' ? (
                                                    <Button
                                                        size="sm"
                                                        kind="danger--ghost"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            const milestone = milestones.find(m => m.id === row.id);
                                                            if (milestone) setMilestoneToDelete(milestone);
                                                        }}
                                                    >
                                                        Delete
                                                    </Button>
                                                ) : (
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
            <Pagination
                totalItems={milestones.length}
                pageSize={pageSize}
                pageSizes={[10]}
                page={currentPage}
                onChange={({ page }) => setCurrentPage(page)}
            />
        </Modal>
    );
};

export default MilestonesModal;