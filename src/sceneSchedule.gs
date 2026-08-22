function setSceneTrigger() {
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if(trigger.getHandlerFunction() === "schedule_scene_Sat_7AM" || trigger.getHandlerFunction() === "schedule_scene_Mon_2PM") {
      ScriptApp.deleteTrigger(trigger);
    }
  });
    
  ScriptApp.newTrigger("schedule_scene_Mon_2PM")
  .timeBased()
  .onWeekDay(ScriptApp.WeekDay.MONDAY)
  .atHour(14)
  .create();
  
  ScriptApp.newTrigger("schedule_scene_Sat_7AM")
  .timeBased()
  .onWeekDay(ScriptApp.WeekDay.SATURDAY)
  .atHour(7)
  .create();
}
// NOTE: these read from new property keys (GOAL_SWE / GOAL_SCENE / GOAL_ACTOR)
// so they don't collide with the Sheet table names ("swe", "scene", "actor").
// Set these three Script Properties to the actual goal sentences, e.g.:
//   GOAL_SWE   -> "Send new software engineering job opportunities via Gmail email"
//   GOAL_SCENE -> "Send scene study information via Gmail email"
//   GOAL_ACTOR -> "Send new acting opportunities via Gmail email"
function resetSceneTriggers() {
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if(trigger.getHandlerFunction() === "schedule_scene_Sat_7AM" || trigger.getHandlerFunction() === "schedule_scene_Mon_2PM") {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  setSceneTrigger();
}

function schedule_scene_Mon_2PM() {
  planner(properties.getProperty('GOAL_SCENE'));
}
 
function schedule_scene_Sat_7AM() {
  planner(properties.getProperty('GOAL_SCENE'));
}
