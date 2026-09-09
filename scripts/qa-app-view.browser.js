async () => {
  const f = page.frames().find(item => item.url().includes('app-content=1'));
  if (!f) throw new Error('Application iframe missing');
  const toggleMode = async () => {
    const current = await f.locator('body').getAttribute('data-display-mode');
    await f.locator('#appViewToggle').click();
    await f.locator(`[data-device-mode="${current === 'app' ? 'desktop' : 'app'}"]`).click();
  };
  const results = [];
  const capture = async (name) => page.screenshot({path:`output/playwright/${name}.png`});
  const check = async (name, callback) => {
    try { const details = await callback(); results.push({name,passed:true,details}); }
    catch(error) { results.push({name,passed:false,error:error.message}); }
  };
  const settled = () => f.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const nav = async (role, view) => {
    const primary = f.locator(`${role === 'student' ? '.mobile-student-nav' : '.app-teacher-nav'} [data-mobile-workspace-view="${view}"]`);
    if (await primary.count()) await primary.click();
    else {
      await f.locator(role === 'student' ? '#studentMobileMoreButton' : '.app-teacher-more').click();
      await f.locator(`${role === 'student' ? '#studentMobileMoreDialog' : '#teacherMobileNavDialog'} [data-mobile-workspace-view="${view}"]`).click();
    }
    await f.locator(`[data-workspace-panel="${view}"]`).waitFor({state:'visible'});
    await settled();
  };
  await f.locator('#appViewToggle').waitFor({state:'visible'});
  await check('single mounted application and unsent text survive both switches', async () => {
    await f.locator('#textQuestion').fill('App 切换保留草稿验证，不发送');
    const before = await f.evaluate(() => ({origin:performance.timeOrigin,role:document.body.dataset.portalRole}));
    await toggleMode();
    await settled();
    if (await f.locator('#textQuestion').inputValue() !== 'App 切换保留草稿验证，不发送') throw new Error('Lost unsent text');
    await capture('app-desktop-verified');
    await toggleMode();
    await settled();
    const after = await f.evaluate(() => ({origin:performance.timeOrigin,role:document.body.dataset.portalRole,width:innerWidth}));
    if (before.origin !== after.origin || before.role !== after.role || after.width !== 390) throw new Error(JSON.stringify({before,after}));
    if (await f.locator('#textQuestion').inputValue() !== 'App 切换保留草稿验证，不发送') throw new Error('Lost App unsent text');
    await f.locator('#textQuestion').fill('');
    return after;
  });
  for (const view of ['agent','course','plan','bank','graph','records','buddy','voice-config']) {
    await check(`student:${view}`, async () => {
      await nav('student',view);
      const bounds = await f.evaluate(() => {
        const p = document.querySelector('[data-workspace-panel]:not([hidden])');
        const r=p.getBoundingClientRect();
        return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,panelWidth:r.width,panelLeft:r.left,panelRight:r.right};
      });
      if (bounds.documentWidth>bounds.viewport+1 || bounds.panelRight>bounds.viewport+1 || bounds.panelLeft < -1) throw new Error(JSON.stringify(bounds));
      await capture(`app-student-${view}`);
      return bounds;
    });
  }
  await check('version dialog stays inside phone and closes', async () => {
    await f.locator('#systemVersionButton').click();
    await f.locator('#systemReleaseDialog').waitFor({state:'visible'});
    const r = await f.locator('#systemReleaseDialog').boundingBox();
    await capture('app-version-dialog');
    await f.locator('#systemReleaseDialogClose').click();
    if (await f.locator('#systemReleaseDialog').isVisible()) throw new Error('Did not close');
    return r;
  });
  await f.locator('#studentMobileMoreButton').click();
  await f.locator('#studentMobileMoreDialog [data-mobile-switch-role="teacher"]').click();
  for (const view of ['teacher-dashboard','teacher-students','teacher-courses','teacher-plan','graph','ontology','bank','video-explanation','agent','lesson-lab','materials','agent-skills','tech-landscape','voice-config']) {
    await check(`teacher:${view}`, async () => {
      await nav('teacher',view);
      const bounds = await f.evaluate(() => {
        const p = document.querySelector('[data-workspace-panel]:not([hidden])');
        const r=p.getBoundingClientRect();
        return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,panelWidth:r.width,panelLeft:r.left,panelRight:r.right};
      });
      if (bounds.documentWidth>bounds.viewport+1 || bounds.panelRight>bounds.viewport+1 || bounds.panelLeft < -1) throw new Error(JSON.stringify(bounds));
      await capture(`app-teacher-${view}`);
      return bounds;
    });
  }
  await check('teacher back navigation', async () => {
    await f.locator('.app-back-button').click();
    if (!(await f.locator('[data-workspace-panel="tech-landscape"]').isVisible())) throw new Error('Wrong back target');
  });
  await check('teacher role/view retained in desktop', async () => {
    const before = await f.evaluate(()=>({role:document.body.dataset.portalRole,view:document.body.dataset.appPage}));
    await toggleMode();
    await settled();
    const after = await f.evaluate(()=>({role:document.body.dataset.portalRole,view:document.body.dataset.appPage}));
    if(JSON.stringify(before)!==JSON.stringify(after)) throw new Error('Role/view changed');
    await toggleMode();
  });
  await f.locator('.app-teacher-more').click();
  await capture('app-teacher-all-tools');
  await f.locator('#teacherMobileNavDialog [data-mobile-switch-role="student"]').click();
  await nav('student','agent');
  await page.setViewportSize({width:375,height:812});
  await settled();
  await check('375px host phone fit', async () => {
    const w=await page.evaluate(()=>{const r=document.querySelector('iframe').getBoundingClientRect();return {width:innerWidth,scroll:document.documentElement.scrollWidth,frame:r.width,left:r.left,right:r.right};});
    if(w.width!==w.scroll || w.right>w.width || w.left<0) throw new Error(JSON.stringify(w));
    await capture('app-small-phone');return w;
  });
  await page.setViewportSize({width:1440,height:1024});
  await settled();
  await capture('app-student-final');
  await page.evaluate(data=>window.__appQA=data,results);
  return results;
}
