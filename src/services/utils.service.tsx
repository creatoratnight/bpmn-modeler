import React from "react";

export const extractBpmnProcessName = (xmlString: string): string | null => {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, "application/xml");
    const processElements = Array.from(xmlDoc.getElementsByTagName("bpmn:process"));

    if (processElements.length > 0) {
        return processElements[0].getAttribute("name");
    } else {
        console.error("No BPMN process element found.");
        return null;
    }
}

export const  extractDmnTableName = (xmlString: string): string | null => {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, "application/xml");
    const processElements = Array.from(xmlDoc.getElementsByTagName("decision"));

    if (processElements.length > 0) {
        return processElements[0].getAttribute("name");
    } else {
        console.error("No DMN table element found.");
        return null;
    }
}

export const camelize = (str) => {
    return str.replace(/(?:^\w|[A-Z]|\b\w)/g, function(word, index) {
        return index === 0 ? word.toLowerCase() : word.toUpperCase();
    }).replace(/\s+/g, '');
}

export const toKebabCase = (str) => {
    return str
        .toLowerCase()
        .replace(/-/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[\s_]+/g, '-')
        .replace(/[^a-z0-9-]/g, '');
}

export const convertDateString = (inputDateString: string): string => {
    const datePart = inputDateString.split('T')[0];
    const timePart = inputDateString.split('T')[1].split(':');

    return `${datePart} ${timePart[0]}:${timePart[1]}`;
}

export const renderMembersCell = (members) => {
    const maxVisibleMembers = 4;
    const extraMembersCount = members.length - maxVisibleMembers;

    return (
        <div style={{ display: 'flex', alignItems: 'center' }}>
            {members.slice(0, maxVisibleMembers).map(member => (
                <div key={member.id} title={`${member.displayName} (${member.role})`} style={{ marginRight: '8px' }}>
                    <img
                        src={member.imageUrl}
                        alt="user-avatar"
                        style={{ width: '30px', height: '30px', borderRadius: '50%' }}
                    />
                </div>
            ))}
            {extraMembersCount > 0 && (
                <div title={`+${extraMembersCount} more`} style={{ marginLeft: '8px' }}>
                    +{extraMembersCount}
                </div>
            )}
        </div>
    );
};

export const sortRows = (rows, header, direction) => {
    return rows.sort((a, b) => {
        if (direction === 'NONE') return 0;
        if (direction === 'DESC') {
            return a[header] < b[header] ? -1 : 1;
        }
        return a[header] > b[header] ? -1 : 1;
    });
};