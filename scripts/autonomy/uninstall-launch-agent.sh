#!/bin/zsh
set -e
LABEL="com.kedabektechlabs.command-center-autonomy"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$PLIST"
print "Uninstalled $LABEL. Repository state and logs were preserved."
