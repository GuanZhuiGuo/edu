async () => {
  await page.goto('http://localhost:3042/?display=app');
  await page.frameLocator('#teacherAppFrame').locator('body[data-portal-role]').waitFor();
  const f=page.frames().find(x=>x.url().includes('app-content=1'));
  await f.locator('.mobile-student-nav:not([hidden]),.app-teacher-nav:not([hidden])').waitFor({state:'visible'});
  const results=[];
  const check=async(name,cb)=>{try{const details=await cb();results.push({name,passed:true,details});}catch(e){results.push({name,passed:false,error:e.message});await page.keyboard.press('Escape');}};
  const settle=()=>f.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const mode=async(m)=>{await f.locator('#appViewToggle').click();await f.locator(`[data-device-mode="${m}"]`).click();await settle();};
  if(await f.locator('body').getAttribute('data-portal-role')!=='student'){await f.locator('.app-teacher-more').click();await f.locator('#teacherMobileNavDialog [data-mobile-switch-role="student"]').click();}
  await f.locator('.mobile-student-nav [data-mobile-workspace-view="agent"]').click();
  await check('device menu Escape restores focus',async()=>{await f.locator('#appViewToggle').click();await f.locator('[data-device-mode="pad"]').focus();await page.keyboard.press('Escape');if(await f.locator('#appDeviceMenu').isVisible())throw new Error('Menu remains open');return await f.evaluate(()=>document.activeElement.id);});
  await check('real backend health dialog and retry',async()=>{await f.locator('#knowledgeConnectionButton').click();await f.locator('.knowledge-connection-refresh').click();await f.locator('.knowledge-connection-refresh:not([disabled])').waitFor();const state=await f.locator('#knowledgeConnectionDialog').innerText();if(!state.includes('Neo4j')||!state.includes('Qdrant'))throw new Error(state);await page.screenshot({path:'output/playwright/device-health-real.png'});await f.locator('.knowledge-connection-close').click();return state;});
  await check('UI healthy and unknown states with mocked health response',async()=>{
    const pattern='**/api/education/knowledge/connections*';
    await page.route(pattern,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({overall:'healthy',checked_at:new Date().toISOString(),components:{neo4j:{status:'healthy'},qdrant:{status:'healthy'}},retrieval:{mode:'remote_hybrid',remote_allowed:true}})}));
    await f.locator('#knowledgeConnectionButton').click();await f.locator('.knowledge-connection-refresh').click();await f.locator('.knowledge-connection-refresh:not([disabled])').waitFor();if(await f.locator('#knowledgeConnectionButton').getAttribute('data-state')!=='healthy')throw new Error('Healthy state incorrect');await page.unroute(pattern);
    await page.route(pattern,route=>route.abort());await f.locator('.knowledge-connection-refresh').click();await f.locator('.knowledge-connection-refresh:not([disabled])').waitFor();if(await f.locator('#knowledgeConnectionButton').getAttribute('data-state')!=='unknown')throw new Error('Network failure presented as known DB status');await page.unroute(pattern);await f.locator('.knowledge-connection-refresh').click();await f.locator('.knowledge-connection-refresh:not([disabled])').waitFor();await f.locator('.knowledge-connection-close').click();
  });
  await check('attachment and draft retained through every mode and orientation',async()=>{
    const original=await f.locator('#textQuestion').inputValue();
    await f.locator('#textQuestion').fill('附件与草稿切换验证，不发送');
    await f.locator('#teacherAttachmentInput').setInputFiles('/var/folders/s8/g9wmptfd5k90rg4vy45ff_cw0000gn/T/codex-clipboard-ae44d0e1-5fe3-4a4b-8570-56bb12474f77.png');
    const origin=await f.evaluate(()=>performance.timeOrigin);
    for(const m of ['desktop','pad','app']){await mode(m);if(m==='pad'){await page.locator('.app-pad-rotate').click();await settle();await page.locator('.app-pad-rotate').click();await settle();}if(!(await f.locator('#teacherAttachmentPreview').isVisible()))throw new Error(`Lost attachment in ${m}`);if(await f.locator('#textQuestion').inputValue()!=='附件与草稿切换验证，不发送')throw new Error(`Lost draft ${m}`);if(await f.evaluate(()=>performance.timeOrigin)!==origin)throw new Error('Rebooted frame');}
    await f.locator('#teacherAttachmentRemoveBtn').click();await f.locator('#textQuestion').fill(original);
  });
  await check('knowledge picker opens and closes on phone',async()=>{await f.locator('#teacherMentionBtn').click();await f.locator('#curriculumPicker').waitFor({state:'visible'});await page.screenshot({path:'output/playwright/device-knowledge-picker.png'});await f.locator('#curriculumPickerCloseBtn').click();});
  await check('phone version and architecture dialog',async()=>{await f.locator('#systemVersionButton').click();await f.locator('#systemReleaseDialog').waitFor({state:'visible'});await page.screenshot({path:'output/playwright/device-version.png'});await f.locator('#systemReleaseDialogClose').click();});
  await check('phone question bank browse and solution',async()=>{await f.locator('.mobile-student-nav [data-mobile-workspace-view="bank"]').click();await f.locator('#studentQuestionBrowserToggle').click();const question=f.locator('[data-question-id]').filter({visible:true}).first();await question.click();const reveal=f.locator('[data-reveal-question-solution]').filter({visible:true}).first();await reveal.click();if(!(await f.locator('[data-question-solution-content]').filter({visible:true}).first().isVisible()))throw new Error('Solution not shown');await page.screenshot({path:'output/playwright/device-question-detail.png'});});
  await check('small host phone fit and menu reachability',async()=>{await page.setViewportSize({width:375,height:812});await settle();const data=await f.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,header:document.querySelector('.global-header').scrollWidth}));if(data.scroll>data.width||data.header>data.width)throw new Error(JSON.stringify(data));await f.locator('#appViewToggle').click();await f.locator('[data-device-mode="pad"]').waitFor({state:'visible'});await page.keyboard.press('Escape');await page.screenshot({path:'output/playwright/device-small-phone.png'});await page.setViewportSize({width:1440,height:1120});return data;});
  await f.locator('.mobile-student-nav [data-mobile-workspace-view="agent"]').click();
  await page.evaluate(r=>window.__interactionQA=r,results);return results;
}
