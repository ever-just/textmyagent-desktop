import { toolRegistry } from '../services/ToolRegistry';
import { saveUserFact, saveUserFactDefinition } from './saveUserFact';
import { getUserFacts, getUserFactsDefinition } from './getUserFacts';
import { searchHistory, searchHistoryDefinition } from './searchHistory';
import { setReminder, setReminderDefinition } from './setReminder';
import { createTrigger, createTriggerDefinition } from './createTrigger';
import { waitTool, waitToolDefinition } from './waitTool';

/**
 * Register all custom tools with the ToolRegistry.
 * Called once at startup.
 */
export function registerAllTools(): void {
  toolRegistry.registerCustomTool(saveUserFactDefinition, saveUserFact);
  toolRegistry.registerCustomTool(getUserFactsDefinition, getUserFacts);
  toolRegistry.registerCustomTool(searchHistoryDefinition, searchHistory);
  toolRegistry.registerCustomTool(setReminderDefinition, setReminder);
  toolRegistry.registerCustomTool(createTriggerDefinition, createTrigger);
  toolRegistry.registerCustomTool(waitToolDefinition, waitTool);
}
