function setSWETrigger() {
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if(trigger.getHandlerFunction() === "schedule_swe_Daily_8AM") {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger("schedule_swe_Daily_8AM")
  .timeBased()
  .everyDays(1)
  .atHour(8)
  .create();
}
 
function resetSWETriggers() {
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if(trigger.getHandlerFunction() === "schedule_swe_Daily_8AM") {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  setSWETrigger();
}
// NOTE: these read from new property keys (GOAL_SWE / GOAL_SCENE / GOAL_ACTOR)
// so they don't collide with the Sheet table names ("swe", "scene", "actor").
// Set these three Script Properties to the actual goal sentences, e.g.:
//   GOAL_SWE   -> "Send new software engineering job opportunities via Gmail email"
//   GOAL_SCENE -> "Send scene study information via Gmail email"
//   GOAL_ACTOR -> "Send new acting opportunities via Gmail email"
function schedule_swe_Daily_8AM() {
  planner(properties.getProperty('GOAL_SWE'));
}
