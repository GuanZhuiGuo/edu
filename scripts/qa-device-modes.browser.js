async () => {
  await page.setViewportSize({width:1440,height:1120});
  await page.goto('http://localhost:3042/?display=app');
  await page.frameLocator('#teacherAppFrame').locator('#appViewToggle').waitFor({state:'visible'});
  const f=page.frames().find(x=>x.url().includes('app-content=1'));
  await f.locator('#appViewToggle').waitFor({state:'visible'});
  await f.locator('body[data-portal-role]').waitFor({state:'visible'});
  await f.locator('.mobile-student-nav:not([hidden]), .app-teacher-nav:not([hidden])').waitFor({state:'visible'});
  const results=[];
  const settled=()=>f.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const mode=async(value)=>{await f.locator('#appViewToggle').click();await f.locator(`[data-device-mode="${value}"]`).click();await settled();};
  const role=async(value)=>{
    if(await f.locator('body').getAttribute('data-portal-role')===value)return;
    if(await f.locator('body').getAttribute('data-display-mode')==='app'){
      const student=value==='teacher';
      await f.locator(student?'#studentMobileMoreButton':'.app-teacher-more').click();
      await f.locator(`${student?'#studentMobileMoreDialog':'#teacherMobileNavDialog'} [data-mobile-switch-role="${value}"]`).click();
    }else await f.locator(`[data-portal-switch="${value}"]`).click();
    await settled();
  };
  const nav=async(r,v)=>{
    if(await f.locator('body').getAttribute('data-display-mode')==='app'){
      const primary=f.locator(`${r==='student'?'.mobile-student-nav':'.app-teacher-nav'} [data-mobile-workspace-view="${v}"]`);
      if(await primary.count())await primary.click();
      else{await f.locator(r==='student'?'#studentMobileMoreButton':'.app-teacher-more').click();await f.locator(`${r==='student'?'#studentMobileMoreDialog':'#teacherMobileNavDialog'} [data-mobile-workspace-view="${v}"]`).click();}
    }else{
      const button=f.locator(`[data-portal-role="${r}"][data-workspace-view="${v}"]`);
      if(!(await button.isVisible()) && await f.locator('.teacher-toolbox > summary').isVisible()) await f.locator('.teacher-toolbox > summary').click();
      await button.click();
    }
    await f.locator(`[data-workspace-panel="${v}"]`).waitFor({state:'visible'});await settled();
  };
  const inspect=()=>f.evaluate(()=>{
    const panel=document.querySelector('[data-workspace-panel]:not([hidden])');
    const all=[...panel.querySelectorAll('*'),...document.querySelectorAll('.global-header *')];
    const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&s.visibility!=='hidden';};
    const short=e=>(e.textContent||e.getAttribute('aria-label')||'').trim().replace(/\s+/g,' ').slice(0,50);
    const tiny=all.filter(e=>visible(e)&&e.children.length===0&&e.textContent.trim()&&parseFloat(getComputedStyle(e).fontSize)<11.9).map(e=>({tag:e.tagName,class:e.className,text:short(e),font:getComputedStyle(e).fontSize}));
    const small=all.filter(e=>e.tagName==='BUTTON'&&visible(e)&&(e.getBoundingClientRect().height<43.9||e.getBoundingClientRect().width<39)).map(e=>({class:e.className,text:short(e),w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height}));
    const clipped=all.filter(e=>visible(e)&&['hidden','clip'].includes(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight+3&&e.children.length===0&&e.textContent.trim()).map(e=>({class:e.className,text:short(e),scroll:e.scrollHeight,client:e.clientHeight}));
    const p=panel.getBoundingClientRect();const header=document.querySelector('.global-header').getBoundingClientRect();
    return {viewport:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,panel:{left:p.left,right:p.right,width:p.width,top:p.top,bottom:p.bottom,height:p.height},header:{width:header.width,scroll:document.querySelector('.global-header').scrollWidth},tiny,small,clipped};
  });
  await mode('app');await role('student');await nav('student','agent');
  await f.locator('#textQuestion').fill('设备切换保留草稿验证，不发送');
  const origin=await f.evaluate(()=>performance.timeOrigin);
  for(const m of ['desktop','pad','app']){await mode(m);if(await f.locator('#textQuestion').inputValue()!=='设备切换保留草稿验证，不发送')throw new Error(`Draft lost: ${m}`);if(await f.evaluate(()=>performance.timeOrigin)!==origin)throw new Error('Application rebooted');}
  results.push({name:'persistent-frame-and-draft',passed:true});
  await f.locator('#textQuestion').fill('');
  const views={student:['agent','course','plan','bank','graph','records','buddy','voice-config'],teacher:['teacher-dashboard','teacher-students','teacher-courses','teacher-plan','graph','ontology','bank','video-explanation','agent','lesson-lab','materials','agent-skills','tech-landscape','voice-config']};
  for(const m of ['app','pad-landscape','pad-portrait']){
    await mode(m==='app'?'app':'pad');
    if(m==='pad-portrait') {await page.locator('.app-pad-rotate').click();await settled();}
    for(const [r,entries]of Object.entries(views)){
      await role(r);
      for(const v of entries){
        try{await nav(r,v);const details=await inspect();await page.screenshot({path:`output/playwright/device-${m}-${r}-${v}.png`});results.push({name:`${m}:${r}:${v}`,passed:details.documentWidth<=details.viewport+1&&details.panel.left>=-1&&details.panel.right<=details.viewport+1&&details.panel.height>120&&details.panel.top<details.height-100,details});}
        catch(error){results.push({name:`${m}:${r}:${v}`,passed:false,error:error.message});}
      }
    }
  }
  await role('student');await nav('student','agent');await mode('app');
  await f.locator('#knowledgeConnectionButton').click();await page.screenshot({path:'output/playwright/device-health-dialog.png'});await f.locator('.knowledge-connection-close').click();
  await page.evaluate(data=>window.__deviceQA=data,results);
  return results;
}
