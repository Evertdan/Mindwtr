import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { generateUUID, tFallback, useTaskStore } from '@mindwtr/core';
import type { Task } from '@mindwtr/core';
import { Check, Trash2, Plus } from 'lucide-react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLanguage } from '../contexts/language-context';
import { useToast } from '../contexts/toast-context';
import { settleStoreAction } from '../components/store-action-result';

export default function FocusChecklistPage() {
    const { id } = useLocalSearchParams();
    const taskId = Array.isArray(id) ? id[0] : id;
    const router = useRouter();
    const { t } = useLanguage();
    const storeTask = useTaskStore(useCallback(
        (state) => state.tasks.find((candidate) => candidate.id === taskId),
        [taskId]
    ));
    const updateTask = useTaskStore((state) => state.updateTask);
    const [task, setTask] = useState(storeTask);
    const { showToast } = useToast();

    // Local state for immediate feedback
    const [checklist, setChecklist] = useState(task?.checklist || []);

    const showChecklistError = (message?: string) => {
        showToast({
            title: tFallback(t, 'common.error', 'Error'),
            message: message || tFallback(t, 'task.updateFailed', 'Could not update task.'),
            tone: 'error',
            durationMs: 4200,
        });
    };

    useEffect(() => {
        if (storeTask) {
            setTask(storeTask);
            setChecklist(storeTask.checklist || []);
        }
    }, [storeTask]);

    // The list renders local state for immediate feedback, and the store→local
    // effect only fires when the store actually changes. So a rejected write
    // (which resolves `{ success: false }` rather than throwing) would otherwise
    // leave the edit on screen forever as if it had saved: roll it back instead.
    const commitChecklist = (newList: NonNullable<Task['checklist']>) => {
        if (!task) return;
        const previous = checklist;
        setChecklist(newList);
        void settleStoreAction(() => updateTask(task.id, { checklist: newList }))
            .then((outcome) => {
                if (outcome.ok) return;
                setChecklist(previous);
                showChecklistError(outcome.message);
            });
    };

    const handleToggle = (index: number) => {
        commitChecklist(checklist.map((item, itemIndex) => (
            itemIndex === index ? { ...item, isCompleted: !item.isCompleted } : item
        )));
    };

    const handleAddItem = () => {
        commitChecklist([...checklist, { id: generateUUID(), title: '', isCompleted: false }]);
    };

    const handleUpdateItem = (index: number, text: string) => {
        commitChecklist(checklist.map((item, itemIndex) => (
            itemIndex === index ? { ...item, title: text } : item
        )));
    };

    const handleDeleteItem = (index: number) => {
        commitChecklist(checklist.filter((_, i) => i !== index));
    };

    if (!task) return (
        <SafeAreaView style={styles.container}>
            <Text>Task not found</Text>
        </SafeAreaView>
    );

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity
                    onPress={() => router.back()}
                    style={styles.backBtn}
                    accessibilityRole="button"
                    accessibilityLabel={tFallback(t, 'common.back', 'Back')}
                >
                    <Ionicons name="chevron-back" color="#000" size={24} />
                </TouchableOpacity>
            </View>

            <View style={styles.titleContainer}>
                <Text style={styles.taskTitle}>{task.title}</Text>
            </View>

            <ScrollView style={styles.content}>
                <View style={styles.checklistContainer}>
                    {checklist.length === 0 && (
                        <Text style={styles.emptyText}>No items in checklist</Text>
                    )}

                    {checklist.map((item, index) => (
                        <View key={item.id || index} style={styles.itemRow}>
                            <TouchableOpacity
                                onPress={() => handleToggle(index)}
                                style={[styles.checkbox, item.isCompleted && styles.checkboxChecked]}
                                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                activeOpacity={0.6}
                            >
                                {item.isCompleted && <Check color="#fff" size={18} />}
                            </TouchableOpacity>

                            <TextInput
                                style={[styles.input, item.isCompleted && styles.inputCompleted]}
                                value={item.title}
                                onChangeText={(text) => handleUpdateItem(index, text)}
                                placeholder={t('taskEdit.itemNamePlaceholder')}
                                multiline
                            />

                            <TouchableOpacity onPress={() => handleDeleteItem(index)} style={styles.deleteBtn}>
                                <Trash2 color="#ccc" size={20} />
                            </TouchableOpacity>
                        </View>
                    ))}

                    <TouchableOpacity style={styles.addBtn} onPress={handleAddItem}>
                        <Plus color="#007AFF" size={20} />
                        <Text style={styles.addBtnText}>Add Item</Text>
                    </TouchableOpacity>
                </View>

                {/* Bottom spacer */}
                <View style={{ height: 100 }} />
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
    },
    header: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#f0f0f0',
    },
    backBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    titleContainer: {
        padding: 20,
        paddingBottom: 10,
    },
    taskTitle: {
        fontSize: 28,
        fontWeight: 'bold',
        color: '#000',
    },
    content: {
        flex: 1,
        paddingHorizontal: 20,
    },
    checklistContainer: {
        marginTop: 10,
    },
    emptyText: {
        color: '#999',
        fontStyle: 'italic',
        marginTop: 10,
    },
    itemRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#f5f5f5',
    },
    checkbox: {
        width: 28,
        height: 28,
        borderRadius: 6,
        borderWidth: 2,
        borderColor: '#007AFF',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    checkboxChecked: {
        backgroundColor: '#007AFF',
    },
    input: {
        flex: 1,
        fontSize: 18,
        color: '#333',
        paddingVertical: 0, // Fix alignment
    },
    inputCompleted: {
        textDecorationLine: 'line-through',
        color: '#999',
    },
    deleteBtn: {
        padding: 8,
    },
    addBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 20,
    },
    addBtnText: {
        fontSize: 16,
        color: '#007AFF',
        fontWeight: '500',
    },
});
