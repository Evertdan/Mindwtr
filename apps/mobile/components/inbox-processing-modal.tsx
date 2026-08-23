import React from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { ChevronDown, ChevronUp, X } from 'lucide-react-native';
import { tFallback } from '@mindwtr/core';

import { AIResponseModal } from './ai-response-modal';
import { ToastViewport } from '@/contexts/toast-context';
import { ThemedAlertHost } from '@/components/themed-alert';
import { styles } from './inbox-processing-modal.styles';
import { useFilledButtonColors } from '@/hooks/use-filled-button-colors';
import { useInboxProcessingController } from './inbox-processing/useInboxProcessingController';
import { InboxActionabilitySection } from './inbox-processing/InboxActionabilitySection';
import { InboxContextSection } from './inbox-processing/InboxContextSection';
import { InboxDatePickers } from './inbox-processing/InboxDatePickers';
import { InboxExecutionSection } from './inbox-processing/InboxExecutionSection';
import { InboxOrganizationSection } from './inbox-processing/InboxOrganizationSection';
import { InboxProjectSection } from './inbox-processing/InboxProjectSection';
import { InboxSchedulingSection } from './inbox-processing/InboxSchedulingSection';
import { InboxTitleSection } from './inbox-processing/InboxTitleSection';
import { InboxTwoMinuteSection } from './inbox-processing/InboxTwoMinuteSection';
import { useAndroidKeyboardInset } from '../lib/use-android-keyboard-inset';

type InboxProcessingModalProps = {
  visible: boolean;
  onClose: () => void;
};

const IOS_KEYBOARD_FOOTER_OFFSET = 48;

export function InboxProcessingModal({ visible, onClose }: InboxProcessingModalProps) {
  const filledButton = useFilledButtonColors();
  const {
    actionabilityChoice,
    addCustomContextMobile,
    aiEnabled,
    aiModal,
    applyTokenSuggestion,
    areaById,
    assignedToSuggestions,
    closeAIModal,
    contextCopilotSuggestions,
    convertToProject,
    currentArea,
    currentProject,
    currentTask,
    defaultScheduleTime,
    delegateFollowUpDate,
    delegateFollowUpDateOnly,
    delegateWho,
    delegateWhoSuggestions,
    executionChoice,
    filteredProjects,
    formatProgressLabel,
    handleAIClarifyInbox,
    handleClose,
    handleConvertToProject,
    handleCreateProjectEarly,
    handleNextTask,
    handleProjectConversionCancel,
    handleProjectConversionStart,
    handleSendDelegateRequest,
    handleSkipTask,
    hasExactProjectMatch,
    headerStyle,
    insets,
    isAIWorking,
    isNextTaskDisabled,
    newContext,
    nextActionDraft,
    extraActionDrafts,
    setExtraActionDrafts,
    laterNoDateSelected,
    pendingDueDate,
    pendingDueDateOnly,
    pendingReviewDate,
    pendingReviewDateOnly,
    pendingStartDate,
    pendingStartDateOnly,
    processingDescription,
    processingScrollRef,
    processingTitle,
    processingTitleFocused,
    projectFirst,
    projectSearch,
    projectTitleDraft,
    referenceEnabled,
    selectedAreaId,
    selectedAssignedTo,
    selectedContexts,
    selectedEnergyLevel,
    selectedPriority,
    selectedProjectId,
    selectedTags,
    selectedTimeEstimate,
    setSelectedAreaId,
    setSelectedAssignedTo,
    setActionabilityChoice,
    setDelegateFollowUpDate,
    setDelegateFollowUpDateOnly,
    setDelegateWho,
    setExecutionChoice,
    setNewContext,
    setLaterNoDateSelected,
    setPendingDueDate,
    setPendingDueDateOnly,
    setPendingReviewDate,
    setPendingReviewDateOnly,
    setPendingStartDate,
    setPendingStartDateOnly,
    setProcessingDescription,
    setProcessingTitle,
    setProcessingTitleFocused,
    setProjectTitleDraft,
    setNextActionDraft,
    setSelectedEnergyLevel,
    setProjectSearch,
    setSelectedPriority,
    setSelectedTimeEstimate,
    setShowDelegateDatePicker,
    setShowDueDatePicker,
    setShowReviewDatePicker,
    setShowStartDatePicker,
    toggleAdvancedOptions,
    setTwoMinuteChoice,
    showDelegateDatePicker,
    showAreaField,
    showAssignedToField,
    showContextSection,
    showContextsField,
    showEnergyLevelField,
    showExecutionSection,
    showExecutionDetails,
    showAdvancedOptions,
    showDueDateField,
    showDueDatePicker,
    showOrganizationSection,
    showPriorityField,
    showProjectField,
    showProjectSection,
    showReviewDateField,
    showReviewDatePicker,
    showSchedulingSection,
    showStartDatePicker,
    showStartDateField,
    showTagsField,
    showTimeEstimateField,
    t,
    tagCopilotSuggestions,
    tc,
    timeEstimateOptions,
    titleDirectionStyle,
    titleInputRef,
    tokenSuggestions,
    totalCount,
    twoMinuteChoice,
    twoMinuteEnabled,
    selectProjectEarly,
    toggleContext,
    toggleTag,
    ENERGY_LEVEL_OPTIONS,
    PRIORITY_OPTIONS,
    processedCount,
  } = useInboxProcessingController({ visible, onClose });

  const aiWorkingLabel = t('ai.working');
  const aiWorkingText = aiWorkingLabel === 'ai.working' ? 'Working...' : aiWorkingLabel;
  const laterLabel = tFallback(t, 'process.later', 'Later');
  const laterHint = tFallback(t, 'process.laterHint', 'Set a start date and move this to Next.');
    const dateOnlyLabel = t('taskEdit.dateOnly');
  const androidKeyboardInset = useAndroidKeyboardInset(visible);

  if (!visible) return null;

  if (!currentTask) {
    const loadingLabel = t('common.loading') !== 'common.loading'
      ? t('common.loading')
      : 'Loading next item...';

    return (
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
        allowSwipeDismissal
        onRequestClose={handleClose}
      >
        <View style={[styles.fullScreenContainer, { backgroundColor: tc.bg }]}>
          <View style={headerStyle}>
            <TouchableOpacity
              style={[styles.headerActionButton, styles.headerActionButtonLeft]}
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              hitSlop={8}
            >
              <X size={22} color={tc.text} strokeWidth={2} />
            </TouchableOpacity>
            <View style={styles.progressContainer}>
              <Text style={[styles.progressText, { color: tc.secondaryText }]}>
                {formatProgressLabel(processedCount, totalCount)}
              </Text>
              <View style={[styles.progressBar, { backgroundColor: tc.border }]}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      backgroundColor: tc.tint,
                      width: totalCount > 0 ? `${(processedCount / totalCount) * 100}%` : '0%',
                    },
                  ]}
                />
              </View>
            </View>
            <View style={styles.headerActionSpacer} />
          </View>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={tc.tint} />
            <Text style={[styles.loadingText, { color: tc.secondaryText }]}>
              {loadingLabel}
            </Text>
          </View>
        </View>
      </Modal>
    );
  }

  const sharedDateRowProps = { tc, defaultScheduleTime, dateOnlyLabel };
  const androidKeyboardLift = Platform.OS === 'android' && androidKeyboardInset > 0
    ? { paddingBottom: androidKeyboardInset }
    : null;
  const projectDetailsSection = (
    <InboxProjectSection
      t={t}
      tc={tc}
      show={showProjectSection}
      showProjectField={showProjectField}
      showAreaField={showAreaField}
      currentProject={currentProject}
      currentArea={currentArea}
      selectedProjectId={selectedProjectId}
      selectedAreaId={selectedAreaId}
      setSelectedAreaId={setSelectedAreaId}
      projectSearch={projectSearch}
      setProjectSearch={setProjectSearch}
      convertToProject={convertToProject}
      projectTitleDraft={projectTitleDraft}
      setProjectTitleDraft={setProjectTitleDraft}
      nextActionDraft={nextActionDraft}
      setNextActionDraft={setNextActionDraft}
      extraActionDrafts={extraActionDrafts}
      setExtraActionDrafts={setExtraActionDrafts}
      filteredProjects={filteredProjects}
      areaById={areaById}
      hasExactProjectMatch={hasExactProjectMatch}
      handleCreateProjectEarly={handleCreateProjectEarly}
      handleConvertToProject={handleConvertToProject}
      handleProjectConversionCancel={handleProjectConversionCancel}
      handleProjectConversionStart={handleProjectConversionStart}
      selectProjectEarly={selectProjectEarly}
    />
  );
  const contextDetailsSection = (
    <InboxContextSection
      t={t}
      tc={tc}
      show={showContextSection}
      showContextsField={showContextsField}
      showTagsField={showTagsField}
      selectedContexts={selectedContexts}
      selectedTags={selectedTags}
      toggleContext={toggleContext}
      toggleTag={toggleTag}
      newContext={newContext}
      setNewContext={setNewContext}
      addCustomContextMobile={addCustomContextMobile}
      tokenSuggestions={tokenSuggestions}
      applyTokenSuggestion={applyTokenSuggestion}
      contextCopilotSuggestions={contextCopilotSuggestions}
      tagCopilotSuggestions={tagCopilotSuggestions}
    />
  );

  return (
    <>
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
        allowSwipeDismissal
        onRequestClose={handleClose}
      >
        <View style={[styles.fullScreenContainer, { backgroundColor: tc.bg }]}>
          <View style={headerStyle}>
            <TouchableOpacity
              style={[styles.headerActionButton, styles.headerActionButtonLeft]}
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              hitSlop={8}
            >
              <X size={22} color={tc.text} strokeWidth={2} />
            </TouchableOpacity>
            <View style={styles.progressContainer}>
              <Text style={[styles.progressText, { color: tc.secondaryText }]}>
                {formatProgressLabel(processedCount, totalCount)}
              </Text>
              <View style={[styles.progressBar, { backgroundColor: tc.border }]}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      backgroundColor: tc.tint,
                      width: totalCount > 0 ? `${(processedCount / totalCount) * 100}%` : '0%',
                    },
                  ]}
                />
              </View>
            </View>
            <TouchableOpacity
              style={[styles.headerActionButton, styles.headerActionButtonRight]}
              onPress={handleSkipTask}
              accessibilityRole="button"
              accessibilityLabel={tFallback(t, 'inbox.skip', 'Skip')}
            >
              <Text style={[styles.skipBtn, { color: tc.tint }]}>
                {tFallback(t, 'inbox.skip', 'Skip')}
              </Text>
            </TouchableOpacity>
          </View>

          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? IOS_KEYBOARD_FOOTER_OFFSET : 0}
            style={[styles.keyboardAvoidingContainer, androidKeyboardLift]}
          >
            <View style={styles.stepContainer}>
              <ScrollView
                ref={processingScrollRef}
                style={styles.singlePageScroll}
                contentContainerStyle={styles.singlePageContent}
                automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
                keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                showsVerticalScrollIndicator={false}
              >
              <InboxTitleSection
                t={t}
                tc={tc}
                titleInputRef={titleInputRef}
                processingTitle={processingTitle}
                setProcessingTitle={setProcessingTitle}
                processingDescription={processingDescription}
                setProcessingDescription={setProcessingDescription}
                processingTitleFocused={processingTitleFocused}
                setProcessingTitleFocused={setProcessingTitleFocused}
                titleDirectionStyle={titleDirectionStyle}
                aiEnabled={aiEnabled}
                isAIWorking={isAIWorking}
                handleAIClarifyInbox={handleAIClarifyInbox}
                aiWorkingText={aiWorkingText}
              />

              <InboxActionabilitySection
                t={t}
                tc={tc}
                actionabilityChoice={actionabilityChoice}
                setActionabilityChoice={setActionabilityChoice}
                referenceEnabled={referenceEnabled}
                laterLabel={laterLabel}
                laterHint={laterHint}
                dateOnlyLabel={dateOnlyLabel}
                pendingStartDate={pendingStartDate}
                laterNoDateSelected={laterNoDateSelected}
                setPendingStartDate={setPendingStartDate}
                setLaterNoDateSelected={setLaterNoDateSelected}
                pendingStartDateOnly={pendingStartDateOnly}
                setPendingStartDateOnly={setPendingStartDateOnly}
                setShowStartDatePicker={setShowStartDatePicker}
                defaultScheduleTime={defaultScheduleTime}
              />

              {actionabilityChoice === 'actionable' && twoMinuteEnabled && (
                <InboxTwoMinuteSection
                  t={t}
                  tc={tc}
                  twoMinuteChoice={twoMinuteChoice}
                  setTwoMinuteChoice={setTwoMinuteChoice}
                />
              )}

              {showExecutionSection && (
                <InboxExecutionSection
                  t={t}
                  executionChoice={executionChoice}
                  setExecutionChoice={setExecutionChoice}
                  delegateWho={delegateWho}
                  setDelegateWho={setDelegateWho}
                  delegateWhoSuggestions={delegateWhoSuggestions}
                  showReviewDateField={showReviewDateField}
                  delegateFollowUpDate={delegateFollowUpDate}
                  setDelegateFollowUpDate={setDelegateFollowUpDate}
                  delegateFollowUpDateOnly={delegateFollowUpDateOnly}
                  setDelegateFollowUpDateOnly={setDelegateFollowUpDateOnly}
                  setShowDelegateDatePicker={setShowDelegateDatePicker}
                  handleSendDelegateRequest={handleSendDelegateRequest}
                  {...sharedDateRowProps}
                />
              )}

              {showExecutionDetails && (
                <>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityState={{ expanded: showAdvancedOptions }}
                    onPress={toggleAdvancedOptions}
                    style={[styles.advancedOptionsButton, { borderColor: tc.border, backgroundColor: tc.cardBg }]}
                  >
                    <Text style={[styles.advancedOptionsText, { color: tc.text }]}>
                      {tFallback(t, 'common.more', 'More options')}
                    </Text>
                    {showAdvancedOptions
                      ? <ChevronUp size={18} color={tc.secondaryText} />
                      : <ChevronDown size={18} color={tc.secondaryText} />}
                  </TouchableOpacity>

                  {showAdvancedOptions && (
                    <>
                      <InboxSchedulingSection
                        t={t}
                        show={showSchedulingSection}
                        showStartDateField={showStartDateField}
                        showDueDateField={showDueDateField}
                        showReviewDateField={showReviewDateField}
                        pendingStartDate={pendingStartDate}
                        setPendingStartDate={setPendingStartDate}
                        pendingStartDateOnly={pendingStartDateOnly}
                        setPendingStartDateOnly={setPendingStartDateOnly}
                        setShowStartDatePicker={setShowStartDatePicker}
                        pendingDueDate={pendingDueDate}
                        setPendingDueDate={setPendingDueDate}
                        pendingDueDateOnly={pendingDueDateOnly}
                        setPendingDueDateOnly={setPendingDueDateOnly}
                        setShowDueDatePicker={setShowDueDatePicker}
                        pendingReviewDate={pendingReviewDate}
                        setPendingReviewDate={setPendingReviewDate}
                        pendingReviewDateOnly={pendingReviewDateOnly}
                        setPendingReviewDateOnly={setPendingReviewDateOnly}
                        setShowReviewDatePicker={setShowReviewDatePicker}
                        {...sharedDateRowProps}
                      />

                      <InboxOrganizationSection
                        t={t}
                        tc={tc}
                        show={showOrganizationSection}
                        showPriorityField={showPriorityField}
                        selectedPriority={selectedPriority}
                        setSelectedPriority={setSelectedPriority}
                        showEnergyLevelField={showEnergyLevelField}
                        selectedEnergyLevel={selectedEnergyLevel}
                        setSelectedEnergyLevel={setSelectedEnergyLevel}
                        showTimeEstimateField={showTimeEstimateField}
                        selectedTimeEstimate={selectedTimeEstimate}
                        setSelectedTimeEstimate={setSelectedTimeEstimate}
                        showAssignedToField={showAssignedToField}
                        selectedAssignedTo={selectedAssignedTo}
                        setSelectedAssignedTo={setSelectedAssignedTo}
                        assignedToSuggestions={assignedToSuggestions}
                        PRIORITY_OPTIONS={PRIORITY_OPTIONS}
                        ENERGY_LEVEL_OPTIONS={ENERGY_LEVEL_OPTIONS}
                        timeEstimateOptions={timeEstimateOptions}
                      />

                      {executionChoice !== 'delegate' && (
                        projectFirst ? (
                          <>
                            {projectDetailsSection}
                            {contextDetailsSection}
                          </>
                        ) : (
                          <>
                            {contextDetailsSection}
                            {projectDetailsSection}
                          </>
                        )
                      )}
                    </>
                  )}
                </>
              )}

              <InboxDatePickers
                configs={[
                  {
                    show: (showStartDateField || actionabilityChoice === 'later') && showStartDatePicker,
                    value: pendingStartDate,
                    onClose: () => setShowStartDatePicker(false),
                    onSelect: (date) => { setPendingStartDate(date); setPendingStartDateOnly(false); setLaterNoDateSelected(false); },
                  },
                  {
                    show: showDueDateField && showDueDatePicker,
                    value: pendingDueDate,
                    onClose: () => setShowDueDatePicker(false),
                    onSelect: (date) => { setPendingDueDate(date); setPendingDueDateOnly(false); },
                  },
                  {
                    show: showReviewDateField && showReviewDatePicker,
                    value: pendingReviewDate,
                    onClose: () => setShowReviewDatePicker(false),
                    onSelect: (date) => { setPendingReviewDate(date); setPendingReviewDateOnly(false); },
                  },
                  {
                    show: showDelegateDatePicker,
                    value: delegateFollowUpDate,
                    onClose: () => setShowDelegateDatePicker(false),
                    onSelect: (date) => { setDelegateFollowUpDate(date); setDelegateFollowUpDateOnly(false); },
                  },
                ]}
              />

              <View style={[styles.singleSection, { borderBottomColor: tc.border }]}>
                <Text style={[styles.stepHint, { color: tc.secondaryText }]}>
                  {tFallback(t, 'inbox.tapNextHint', 'Tap "Next task" at the bottom to apply your choices and move on.')}
                </Text>
              </View>
              </ScrollView>

              <View style={[styles.bottomActionBar, { borderTopColor: tc.border, paddingBottom: Math.max(insets.bottom, 10) }]}>
                <TouchableOpacity
                  style={[
                    styles.bottomNextButton,
                    { backgroundColor: filledButton.backgroundColor },
                    isNextTaskDisabled && { opacity: 0.5 },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: isNextTaskDisabled }}
                  disabled={isNextTaskDisabled}
                  onPress={handleNextTask}
                >
                  <Text style={[styles.bottomNextButtonText, { color: filledButton.textColor ?? tc.onTint }]}>
                    {tFallback(t, 'inbox.nextTask', 'Next task →')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
        <ToastViewport />
        {/* The AI failure alert fires while this modal is up (#940). */}
        <ThemedAlertHost />
      </Modal>
      {aiModal && (
        <AIResponseModal
          visible={Boolean(aiModal)}
          title={aiModal.title}
          message={aiModal.message}
          actions={aiModal.actions}
          onClose={closeAIModal}
        />
      )}
    </>
  );
}
