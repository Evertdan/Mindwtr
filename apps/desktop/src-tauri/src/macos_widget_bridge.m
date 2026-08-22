#import <Foundation/Foundation.h>
#include <stdlib.h>
#include <string.h>

/// Resolves the shared App Group container directory for `app_group_cstr`.
/// Returns a heap-allocated UTF-8 path string on success, or NULL when the
/// container is unavailable -- an unsigned dev build, a build missing the
/// `com.apple.security.application-groups` entitlement, or an app group the
/// OS has not (yet) provisioned. Callers must treat NULL as "skip, don't
/// error" (#1054 decision 4), never as a hard failure.
/// The caller must free a non-NULL result with `mindwtr_macos_widget_free_string`.
char *mindwtr_macos_widget_container_path(const char *app_group_cstr) {
    if (!app_group_cstr) return NULL;

    NSString *groupId = [NSString stringWithUTF8String:app_group_cstr];
    NSFileManager *fileManager = [NSFileManager defaultManager];
    NSURL *containerURL = [fileManager containerURLForSecurityApplicationGroupIdentifier:groupId];
    if (!containerURL) return NULL;

    const char *path = [[containerURL path] UTF8String];
    if (!path) return NULL;

    return strdup(path);
}

/// Free a string returned by `mindwtr_macos_widget_container_path`.
void mindwtr_macos_widget_free_string(char *ptr) {
    free(ptr);
}
