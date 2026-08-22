function setActorTrigger() {
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if(trigger.getHandlerFunction() === "schedule_actor_TueThu_5PM") {
      ScriptApp.deleteTrigger(trigger);
    }
  });
 
  ScriptApp.newTrigger("schedule_actor_TueThu_5PM")
  .timeBased()
  .onWeekDay(ScriptApp.WeekDay.TUESDAY)
  .atHour(17)
  .create();
 
  ScriptApp.newTrigger("schedule_actor_TueThu_5PM")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.THURSDAY)
    .atHour(17)
    .create();
}
 
function resetActorTriggers() {
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if(trigger.getHandlerFunction() === "schedule_actor_TueThu_5PM") {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  setActorTrigger();
}
// NOTE: these read from new property keys (GOAL_SWE / GOAL_SCENE / GOAL_ACTOR)
// so they don't collide with the Sheet table names ("swe", "scene", "actor").
// Set these three Script Properties to the actual goal sentences, e.g.:
//   GOAL_SWE   -> "Send new software engineering job opportunities via Gmail email"
//   GOAL_SCENE -> "Send scene study information via Gmail email"
//   GOAL_ACTOR -> "Send new acting opportunities via Gmail email"
function schedule_actor_TueThu_5PM() {
  planner(properties.getProperty('GOAL_ACTOR'));
}
