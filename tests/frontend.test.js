import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../src/server.js';
import { emptyWorkspace } from '../public/js/api.js';
import { escapeHTML } from '../public/js/ui.js';
import { showroom, projectPage } from '../public/js/project.js';

test('static server serves the application and refuses backend writes', async () => {
  const server=createAppServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const home=await fetch(base); assert.equal(home.status,200); assert.match(await home.text(),/type="module"/);
    for(const path of ['/css/styles.css','/js/app.js','/js/api.js','/js/project.js','/favicon.svg']) assert.equal((await fetch(base+path)).status,200,path);
    assert.equal((await fetch(base+'/api/login',{method:'POST'})).status,405);
    assert.equal((await fetch(base+'/missing')).status,404);
    assert.equal((await fetch(base+'/%2e%2e%2fpackage.json')).status,403);
    const head=await fetch(base,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  } finally { await new Promise(resolve=>server.close(resolve)); }
});

test('initial workspace contains no invented personal or project data', () => {
  const state=emptyWorkspace(); assert.deepEqual(state.projects,[]);
  assert.ok(Object.values(state.profile).every(value=>value===''));
  const home=showroom(state); assert.match(home,/Project title/); assert.doesNotMatch(home,/Alex Morgan|Obsidian Studio|<img/);
});

test('user text cannot become markup in project views', () => {
  const title='<img src=x onerror=alert(1)>';
  assert.equal(escapeHTML(title),'&lt;img src=x onerror=alert(1)&gt;');
  const state=emptyWorkspace();state.projects.push({id:'test',published:true,type:'open',title,description:'<script>bad()</script>'});
  for(const view of [showroom(state),projectPage(state,'test')]) {
    assert.ok(view.includes('&lt;img'));assert.ok(!view.includes('<img src=x'));assert.ok(!view.includes('<script>bad'));
  }
});
