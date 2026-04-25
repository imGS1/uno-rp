
require('dotenv').config();
const express=require('express'), session=require('express-session'), axios=require('axios'), path=require('path'), fs=require('fs');
const Stripe=require('stripe');
const {Client,GatewayIntentBits,Partials,EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle}=require('discord.js');

const app=express(), PORT=process.env.PORT||3000, stripe=process.env.STRIPE_SECRET_KEY?Stripe(process.env.STRIPE_SECRET_KEY):null;
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers,GatewayIntentBits.DirectMessages],partials:[Partials.Channel]});
const D=path.join(__dirname,'data');
const productsFile=path.join(D,'products.json'), ordersFile=path.join(D,'orders.json'), newsFile=path.join(D,'news.json'), rulesFile=path.join(D,'rules.json'), siteFile=path.join(D,'site.json');
const applications=new Map();
const read=(f,d=[])=>{try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return d}};
const write=(f,d)=>fs.writeFileSync(f,JSON.stringify(d,null,2),'utf8');
const base=()=> (process.env.PUBLIC_BASE_URL||`http://localhost:${PORT}`).replace(/\/$/,'');
const envList=n=>(process.env[n]||'').split(',').map(x=>x.trim()).filter(Boolean);
async function guild(){return client.guilds.fetch(process.env.GUILD_ID).catch(()=>null)}
async function member(id){const g=await guild();return g?g.members.fetch(id).catch(()=>null):null}
async function hasDash(id){const allowed=envList('DASHBOARD_ROLE_IDS'); if(!allowed.length)return false; const m=await member(id); return !!(m&&allowed.some(r=>m.roles.cache.has(r)))}
function avatar(u){return u?.avatar?`https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=256`:null}
async function log(channelId, embed){if(!channelId)return; const c=await client.channels.fetch(channelId).catch(()=>null); if(c?.isTextBased()) await c.send({embeds:[embed]}).catch(()=>null)}
async function giveRole(userId,p){const rid=process.env[p.roleEnv]; if(!rid)return{ok:false,reason:'رتبة المنتج غير مضافة في env'}; const m=await member(userId); if(!m)return{ok:false,reason:'العضو غير موجود بالسيرفر'}; await m.roles.add(rid); return{ok:true}}
function publicUser(u){return{ id:u.id, username:u.username, global_name:u.global_name, avatar:u.avatar, avatarUrl: avatar(u) }}

app.use('/stripe/webhook',express.raw({type:'application/json'}));
app.use(express.urlencoded({extended:true})); app.use(express.json());
app.use(session({secret:process.env.SESSION_SECRET||'uno-secret',resave:false,saveUninitialized:false}));
app.use(express.static(path.join(__dirname,'public')));
function requireLogin(req,res,next){if(!req.session.user)return res.status(401).json({ok:false,message:'سجل دخولك بالديسكورد'}); next()}
async function requireDash(req,res,next){if(!req.session.user)return res.status(401).json({ok:false,message:'سجل دخولك'}); if(!(await hasDash(req.session.user.id)))return res.status(403).json({ok:false,message:'ليس لديك صلاحية'}); next()}

app.get('/api/site',(req,res)=>res.json(read(siteFile,{})));
app.get('/api/rules',(req,res)=>res.json(read(rulesFile,{})));
app.get('/api/products',(req,res)=>res.json(read(productsFile)));
app.get('/api/news',(req,res)=>res.json(read(newsFile).map(n=>({...n,displayDate:n.date||new Date(n.createdAt||Date.now()).toLocaleDateString('ar-SA',{year:'numeric',month:'long',day:'numeric'})}))));
app.get('/me',(req,res)=>res.json(req.session.user||null));
app.get('/config',(req,res)=>res.json({discordInvite:process.env.DISCORD_INVITE||read(siteFile,{}).discordInvite||'https://discord.gg/unn'}));
app.get('/api/team',async(req,res)=>{
  const site=read(siteFile,{});
  if(site.teamMode==='manual' && Array.isArray(site.team)){
    return res.json(site.team.map(x=>({
      role:x.role||'Member',
      name:x.name||'',
      avatar:x.avatar||'/assets/logo.png'
    })));
  }
  const ids=[process.env.TEAM_OWNER_ID,...envList('TEAM_DEVELOPER_IDS')].filter(Boolean);
  const out=[];
  for(const id of ids){
    const m=await member(id), u=m?.user;
    out.push({id, role:id===process.env.TEAM_OWNER_ID?'Owner 👑':'Developer ⚙️', name:m?.displayName||u?.globalName||u?.username||id, avatar:u?.displayAvatarURL({size:256})||'/assets/logo.png'});
  }
  res.json(out);
});
app.get('/login',(req,res)=>{
  if(!process.env.CLIENT_ID||!process.env.REDIRECT_URI)return res.status(500).send('Discord OAuth غير مضبوط في env');
  res.redirect('https://discord.com/oauth2/authorize?'+new URLSearchParams({client_id:process.env.CLIENT_ID,redirect_uri:process.env.REDIRECT_URI,response_type:'code',scope:'identify'}));
});
app.get('/callback',async(req,res)=>{
  try{
    const token=await axios.post('https://discord.com/api/oauth2/token',new URLSearchParams({client_id:process.env.CLIENT_ID,client_secret:process.env.CLIENT_SECRET,grant_type:'authorization_code',code:req.query.code,redirect_uri:process.env.REDIRECT_URI}),{headers:{'Content-Type':'application/x-www-form-urlencoded'}});
    const user=await axios.get('https://discord.com/api/users/@me',{headers:{Authorization:`Bearer ${token.data.access_token}`}});
    req.session.user=publicUser(user.data); res.redirect('/');
  }catch(e){console.error(e.response?.data||e.message); res.status(500).send('فشل تسجيل الدخول. تأكد من REDIRECT_URI')}
});
app.get('/logout',(req,res)=>req.session.destroy(()=>res.redirect('/')));

app.post('/api/checkout',requireLogin,async(req,res)=>{
  if(!stripe)return res.status(500).json({ok:false,message:'Stripe غير مضبوط'});
  const p=read(productsFile).find(x=>x.id===req.body.productId);
  if(!p)return res.status(404).json({ok:false,message:'المنتج غير موجود'});
  if(!Number(p.price))return res.status(400).json({ok:false,message:'هذا المنتج يحتاج تحديد سعر'});
  try{
    const s=await stripe.checkout.sessions.create({
      mode:'payment',payment_method_types:['card'],success_url:`${base()}/success.html?session_id={CHECKOUT_SESSION_ID}`,cancel_url:`${base()}/store.html?cancelled=1`,
      line_items:[{quantity:1,price_data:{currency:p.currency.toLowerCase(),unit_amount:Math.round(Number(p.price)*100),product_data:{name:p.name,description:p.features.join(' - '),images:[`${base()}${p.image}`]}}}],
      metadata:{userId:req.session.user.id,username:req.session.user.global_name||req.session.user.username,productId:p.id}
    });
    const orders=read(ordersFile); orders.push({id:s.id,userId:req.session.user.id,username:req.session.user.global_name||req.session.user.username,productId:p.id,productName:p.name,amount:p.price,currency:p.currency,status:'pending',roleGiven:false,createdAt:Date.now()}); write(ordersFile,orders);
    await log(process.env.STORE_LOG_CHANNEL_ID,new EmbedBuilder().setTitle('🛒 محاولة شراء').setColor(0xff3333).addFields({name:'المستخدم',value:`<@${req.session.user.id}>`,inline:true},{name:'المنتج',value:p.name,inline:true},{name:'السعر',value:`${p.price} ${p.currency}`,inline:true}).setTimestamp());
    res.json({ok:true,url:s.url});
  }catch(e){console.error(e);res.status(500).json({ok:false,message:'فشل إنشاء الدفع'})}
});
app.post('/stripe/webhook',async(req,res)=>{
  if(!stripe||!process.env.STRIPE_WEBHOOK_SECRET)return res.status(500).send('Stripe webhook not configured');
  let event; try{event=stripe.webhooks.constructEvent(req.body,req.headers['stripe-signature'],process.env.STRIPE_WEBHOOK_SECRET)}catch(e){return res.status(400).send('Webhook Error')}
  if(event.type==='checkout.session.completed'){
    const s=event.data.object,{userId,productId}=s.metadata||{},p=read(productsFile).find(x=>x.id===productId);
    if(userId&&p){
      const result=await giveRole(userId,p).catch(e=>({ok:false,reason:e.message}));
      const orders=read(ordersFile),o=orders.find(x=>x.id===s.id); if(o){o.status='paid';o.paidAt=Date.now();o.roleGiven=!!result.ok;o.roleError=result.reason||null;write(ordersFile,orders)}
      await log(process.env.STORE_LOG_CHANNEL_ID,new EmbedBuilder().setTitle(result.ok?'✅ شراء ناجح':'⚠️ دفع ناجح ولم يتم تسليم الرتبة').setColor(result.ok?0x22c55e:0xf59e0b).addFields({name:'المستخدم',value:`<@${userId}>`,inline:true},{name:'المنتج',value:p.name,inline:true},{name:'الحالة',value:result.ok?'تم التسليم':result.reason}).setTimestamp());
      const m=await member(userId); if(m)await m.send({embeds:[new EmbedBuilder().setTitle('✅ تم تأكيد الشراء').setDescription(result.ok?`تم تسليم **${p.name}**`:`تم الدفع لكن تعذر تسليم **${p.name}**`).setColor(result.ok?0x22c55e:0xf59e0b)]}).catch(()=>null);
    }
  }
  res.json({received:true});
});
app.get('/api/dashboard/check',requireDash,(req,res)=>res.json({ok:true}));
app.get('/api/dashboard/orders',requireDash,(req,res)=>res.json(read(ordersFile).sort((a,b)=>b.createdAt-a.createdAt)));
app.get('/api/dashboard/news',requireDash,(req,res)=>res.json(read(newsFile).sort((a,b)=>b.id-a.id)));
app.post('/api/dashboard/news',requireDash,async(req,res)=>{
  const news=read(newsFile); const item={id:Date.now(),title:req.body.title||'خبر جديد',body:req.body.body||'',date:req.body.date||new Date().toLocaleDateString('ar-SA',{year:'numeric',month:'long',day:'numeric'}),by:req.session.user.global_name||req.session.user.username,createdAt:Date.now()}; news.push(item); write(newsFile,news);
  await log(process.env.NEWS_LOG_CHANNEL_ID,new EmbedBuilder().setTitle('📰 خبر جديد').setColor(0xff3333).addFields({name:'العنوان',value:item.title},{name:'بواسطة',value:`<@${req.session.user.id}>`,inline:true},{name:'التاريخ',value:item.date,inline:true}).setTimestamp());
  res.json({ok:true,item});
});
app.delete('/api/dashboard/news/:id',requireDash,async(req,res)=>{const news=read(newsFile),target=news.find(n=>n.id===Number(req.params.id));write(newsFile,news.filter(n=>n.id!==Number(req.params.id)));if(target)await log(process.env.NEWS_LOG_CHANNEL_ID,new EmbedBuilder().setTitle('🗑️ حذف خبر').setColor(0xef4444).addFields({name:'العنوان',value:target.title},{name:'بواسطة',value:`<@${req.session.user.id}>`}).setTimestamp());res.json({ok:true})});
app.post('/api/dashboard/orders/:id/give-role',requireDash,async(req,res)=>{const orders=read(ordersFile),o=orders.find(x=>x.id===req.params.id);if(!o)return res.status(404).json({ok:false,message:'الطلب غير موجود'});const p=read(productsFile).find(x=>x.id===o.productId);if(!p)return res.status(404).json({ok:false,message:'المنتج غير موجود'});const r=await giveRole(o.userId,p).catch(e=>({ok:false,reason:e.message}));o.roleGiven=!!r.ok;o.roleError=r.reason||null;write(ordersFile,orders);res.json({ok:!!r.ok,message:r.reason})});
app.post('/api/apply',requireLogin,async(req,res)=>{try{const c=await client.channels.fetch(process.env.APPLICATION_CHANNEL_ID).catch(()=>null);if(!c?.isTextBased())return res.status(500).json({ok:false,message:'روم التقديم غير صحيح'});const id=`${Date.now()}-${req.session.user.id}`;applications.set(id,{user:req.session.user,answers:req.body});const embed=new EmbedBuilder().setTitle('📩 تقديم إدارة جديد').setColor(0xff1b1b).setDescription(`المتقدم: <@${req.session.user.id}>`).setThumbnail(req.session.user.avatarUrl||null).addFields({name:'الاسم',value:req.body.name||'غير مذكور'},{name:'العمر',value:req.body.age||'غير مذكور'},{name:'الخبرات',value:req.body.experience||'غير مذكور'},{name:'سبب التقديم',value:req.body.reason||'غير مذكور'},{name:'تعريف RP',value:req.body.roleplay||'غير مذكور'},{name:'VDM/RDM',value:req.body.vdmrdm||'غير مذكور'}).setTimestamp();const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`accept:${id}`).setLabel('قبول').setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId(`reject:${id}`).setLabel('رفض').setStyle(ButtonStyle.Danger));await c.send({embeds:[embed],components:[row]});res.json({ok:true})}catch(e){res.status(500).json({ok:false,message:'خطأ في إرسال التقديم'})}});
client.on('interactionCreate',async i=>{if(!i.isButton()||(!i.customId.startsWith('accept:')&&!i.customId.startsWith('reject:')))return;const reviewerRoles=envList('REVIEWER_ROLE_IDS');if(reviewerRoles.length){const r=await i.guild.members.fetch(i.user.id).catch(()=>null);if(!r||!reviewerRoles.some(id=>r.roles.cache.has(id)))return i.reply({content:'ما عندك صلاحية',ephemeral:true})}const [act,id]=i.customId.split(':'),appData=applications.get(id);if(!appData)return i.reply({content:'التقديم غير موجود',ephemeral:true});const ok=act==='accept',m=await member(appData.user.id);if(ok&&m&&process.env.ACCEPTED_ROLE_ID)await m.roles.add(process.env.ACCEPTED_ROLE_ID).catch(()=>null);if(m){const rows=[];if(ok&&process.env.INTERVIEW_CHANNEL_LINK)rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('روم انتظار المقابلة').setStyle(ButtonStyle.Link).setURL(process.env.INTERVIEW_CHANNEL_LINK)));await m.send({embeds:[new EmbedBuilder().setTitle(ok?'🎉 تم قبولك مبدئيًا':'❌ تم رفض طلبك').setColor(ok?0x22c55e:0xef4444).setDescription(ok?'يرجى التوجه إلى روم انتظار المقابلة.':'يمكنك المحاولة لاحقًا.')],components:rows}).catch(()=>null)}await log(process.env.APPLICATION_LOG_CHANNEL_ID,new EmbedBuilder().setTitle(ok?'✅ قبول تقديم':'❌ رفض تقديم').setColor(ok?0x22c55e:0xef4444).addFields({name:'المتقدم',value:`<@${appData.user.id}>`,inline:true},{name:'المراجع',value:`<@${i.user.id}>`,inline:true}).setTimestamp());await i.update({components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('done').setLabel(ok?'تم القبول':'تم الرفض').setStyle(ok?ButtonStyle.Success:ButtonStyle.Danger).setDisabled(true))]}).catch(()=>null)});
client.once('ready',()=>console.log(`Discord bot ready as ${client.user.tag}`));
if(process.env.BOT_TOKEN)client.login(process.env.BOT_TOKEN);else console.log('BOT_TOKEN is empty');
app.listen(PORT,()=>console.log(`Uno RP running on ${base()}`));
