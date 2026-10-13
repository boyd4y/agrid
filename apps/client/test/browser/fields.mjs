import assert from 'node:assert/strict';
import { createBrowserFixture } from './fixture.mjs';
const fixture = await createBrowserFixture({ name: 'Fields Browser' });
const { page, api, errors, frontend, artifact } = fixture;
try {
 // Shared field type icons and nested color picker actually persist the custom HEX.
 const colorTable=await api('/tables',{name:'Color fixture'});
 const colorColumn=await api('/tables/'+colorTable.id+'/columns',{name:'阶段',type:'select',config:{options:[{id:'todo',label:'待办',color:'#d3e5ef'}]}});
 await api('/tables/'+colorTable.id+'/rows',{cells:{[colorColumn.id]:'todo'}});
 await page.goto(frontend+'/app/tables/'+colorTable.id);
 await page.locator('[data-col-header="阶段"]').hover();await page.getByRole('button',{name:'阶段列设置',exact:true}).click();
 const settings=page.getByTestId('column-settings-editor');await settings.waitFor();
 await settings.getByRole('combobox').first().click();assert.equal(await page.getByRole('option').count(),10);for(const option of await page.getByRole('option').all())assert((await option.locator('svg').count())>=1,'every field type has an icon');await page.keyboard.press('Escape');
 await settings.getByRole('button',{name:'待办的颜色',exact:true}).click();
 const picker=page.getByTestId('color-picker');await picker.waitFor();assert.equal(await picker.getByRole('button',{pressed:false}).count()>0,true);
 await picker.getByRole('textbox',{name:'HEX 颜色',exact:true}).fill('#GGG');await picker.getByRole('textbox',{name:'HEX 颜色',exact:true}).press('Enter');await picker.getByText('请输入有效的 3 位或 6 位 HEX。',{exact:true}).waitFor();
 await picker.getByRole('textbox',{name:'HEX 颜色',exact:true}).fill('#123');await picker.getByRole('textbox',{name:'HEX 颜色',exact:true}).press('Escape');await picker.waitFor({state:'detached'});await settings.waitFor();
 await settings.getByRole('button',{name:'保存',exact:true}).click();await settings.waitFor({state:'detached'});
 assert.equal((await api('/tables/'+colorTable.id)).columns.find(c=>c.id===colorColumn.id).config.options[0].color,'#112233');
 await page.reload();await page.getByText('待办',{exact:true}).waitFor();assert.equal(await page.getByText('待办',{exact:true}).evaluate(el=>getComputedStyle(el.parentElement).backgroundColor),'rgb(17, 34, 51)');
 await page.screenshot({path:artifact('tabdo-custom-color-reviewed.png')});
 await page.getByRole('button',{name:'阶段：点击编辑',exact:true}).click();await page.getByRole('textbox',{name:'搜索选项',exact:true}).waitFor();
 const chip=page.getByRole('button',{name:'待办',exact:true}).getByText('待办',{exact:true});assert.equal(await chip.evaluate(el=>getComputedStyle(el.parentElement).backgroundColor),'rgb(17, 34, 51)');await page.keyboard.press('Escape');
 for(const theme of ['light','dark']){
  await page.emulateMedia({colorScheme:theme});await page.waitForFunction(t=>document.documentElement.classList.contains(t),theme);
  await page.locator('[data-col-header="阶段"]').hover();await page.getByRole('button',{name:'阶段列设置',exact:true}).click();await settings.getByRole('button',{name:'待办的颜色',exact:true}).click();await picker.waitFor();await page.screenshot({path:artifact('tabdo-color-picker-')+theme+'.png'});await picker.getByRole('button',{name:'绿色',exact:true}).click();await page.keyboard.press('Escape');await picker.waitFor({state:'detached'});await settings.getByRole('button',{name:'取消',exact:true}).click();assert.equal((await api('/tables/'+colorTable.id)).columns.find(c=>c.id===colorColumn.id).config.options[0].color,'#112233');
 }
 await page.emulateMedia({colorScheme:'light'});
 await page.goto(frontend+'/app/members');await page.getByRole('heading',{name:'成员',exact:true}).waitFor();await page.getByTestId('members-invite-open').click();await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});

 // Summary data is a Popover and never changes the dashboard widget rectangle.
 const table=await api('/tables',{name:'Popover sales'}),group=await api('/tables/'+table.id+'/columns',{name:'阶段',type:'select',config:{options:[{id:'todo',label:'待办'},{id:'done',label:'完成'}]}});
 await api('/tables/'+table.id+'/rows',{cells:{[group.id]:'todo'}});await api('/tables/'+table.id+'/rows',{cells:{[group.id]:'done'}});
 await page.goto(frontend+'/app/reports/new');await page.getByTestId('builder-layout').waitFor();await page.getByRole('complementary',{name:'组件',exact:true}).getByRole('button',{name:'图表',exact:true}).click();
 await page.locator('#report-source').click();await page.getByRole('option',{name:'Popover sales',exact:true}).click();await page.locator('#report-group').click();await page.getByRole('option',{name:'阶段',exact:true}).click();
 const widget=page.locator('[data-widget-id]').first();await widget.getByTestId('report-summary-trigger').waitFor();const before=await widget.boundingBox();
 for(const theme of ['light','dark']){await page.emulateMedia({colorScheme:theme});await page.waitForFunction(t=>document.documentElement.classList.contains(t),theme);await widget.getByTestId('report-summary-trigger').click();await page.getByTestId('report-summary-popover').getByRole('cell',{name:'待办',exact:true}).waitFor();assert.equal(await page.locator('details').count(),0);const after=await widget.boundingBox();assert.equal(after.height,before.height);assert.equal(after.width,before.width);await page.screenshot({path:artifact('tabdo-report-popover-')+theme+'.png'});await page.keyboard.press('Escape');await page.getByTestId('report-summary-popover').waitFor({state:'detached'});}

assert.deepEqual(errors, []); console.log('PASS field icons, HEX validation/persistence, enum colors and cancellation, light/dark presets, report summary Popover geometry');
} catch(error) { console.error((await page.locator('body').innerText()).slice(-5000)); await page.screenshot({path:artifact('fields-failure.png')}); throw error; } finally { await fixture.close(); }
