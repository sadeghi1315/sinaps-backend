const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { createClient } = require('@libsql/client');

const app = express();

app.use(cors());
app.use(express.json({ limit:'1mb' }));

const PORT=process.env.PORT||10000;

const DB_URL=process.env.TURSO_DATABASE_URL;
const DB_TOKEN=process.env.TURSO_AUTH_TOKEN;

const BOT_TOKEN=process.env.TELEGRAM_BOT_TOKEN||'';

const TREASURY_WALLET=
  process.env.TREASURY_WALLET||
  'UQDMsJu14wu-EHSjaRpufQdPb73pKVRkQvHNezgA2zF69sJX';

const SNP_CONTRACT=
  'EQAmLlerUViNn9PwFVRlR_AjDvhd5pkmeLNOu5bNDpvXV0ls';

const TONCENTER_API_KEY=
  process.env.TONCENTER_API_KEY||'';

const TONCENTER='https://toncenter.com/api/v3';

const FEE_NANO='100000000';

const REFERRAL_RATE=0.15;

const TASKS={

  channel:{
    id:'channel',
    title:'Join SINAPS Channel',
    reward:100,
    icon:'📢',
    url:'https://t.me/SINAPS_COIN',
    chat:'@SINAPS_COIN'
  },

  group:{
    id:'group',
    title:'Join SINAPS Group',
    reward:70,
    icon:'👥',
    url:'https://t.me/SINAPS_Group',
    chat:'@SINAPS_Group'
  },

  twitter:{
    id:'twitter',
    title:'Follow SINAPS on X',
    reward:50,
    icon:'𝕏',
    url:'https://x.com/SINAPS_SNP'
  },

  holder:{
    id:'holder',
    title:'Hold 50,000 SNP',
    reward:1000,
    icon:'💎',
    url:'#'
  }

};

if(!DB_URL||!DB_TOKEN){

  console.error(
    'Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN'
  );

  process.exit(1);
}

const db=createClient({
  url:DB_URL,
  authToken:DB_TOKEN
});

/* =========================================================
   TELEGRAM AUTH
========================================================= */

function verifyTelegram(initData){

  if(!BOT_TOKEN||!initData)
    return null;

  try{

    const params=new URLSearchParams(initData);

    const hash=params.get('hash');

    if(!hash)return null;

    params.delete('hash');

    const dataCheck=Array
      .from(params.entries())
      .sort(([a],[b])=>a.localeCompare(b))
      .map(([k,v])=>`${k}=${v}`)
      .join('\n');

    const secret=crypto
      .createHmac('sha256','WebAppData')
      .update(BOT_TOKEN)
      .digest();

    const calculated=crypto
      .createHmac('sha256',secret)
      .update(dataCheck)
      .digest('hex');

    if(calculated!==hash)
      return null;

    const authDate=Number(params.get('auth_date')||0);

    if(Date.now()/1000-authDate>86400)
      return null;

    const telegramUser=
      JSON.parse(params.get('user')||'{}');

    return telegramUser;

  }catch{

    return null;
  }
}

function auth(req){

  const header=req.headers['x-telegram-init-data'];

  const verified=verifyTelegram(header||'');

  if(verified?.id)
    return Number(verified.id);

  return null;
}

function normalizeId(value){

  const n=Number(value);

  if(!Number.isSafeInteger(n)||n<=0)
    return null;

  return n;
}

/* =========================================================
   TELEGRAM API
========================================================= */

async function telegram(method,params={}){

  if(!BOT_TOKEN)
    throw new Error('TELEGRAM_BOT_TOKEN is missing');

  const r=await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
    {
      method:'POST',
      headers:{
        'Content-Type':'application/json'
      },
      body:JSON.stringify(params)
    }
  );

  const d=await r.json();

  if(!d.ok)
    throw new Error(
      d.description||'Telegram API error'
    );

  return d.result;
}

/* =========================================================
   DATABASE
========================================================= */

async function initDatabase(){

  await db.execute(`
    CREATE TABLE IF NOT EXISTS users(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER NOT NULL UNIQUE,
      username TEXT DEFAULT '',
      balance INTEGER NOT NULL DEFAULT 0,
      energy INTEGER NOT NULL DEFAULT 1000,
      max_energy INTEGER NOT NULL DEFAULT 1000,
      last_energy_update TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_daily_bonus TEXT,
      daily_streak INTEGER NOT NULL DEFAULT 0,
      referral_code TEXT UNIQUE,
      referred_by INTEGER,
      wallet_address TEXT
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS task_claims(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER NOT NULL,
      task_id TEXT NOT NULL,
      reward INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(telegram_id,task_id)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS daily_rewards(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER NOT NULL,
      day INTEGER NOT NULL,
      reward INTEGER NOT NULL,
      claimed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(telegram_id,day)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS transactions(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'completed',
      details TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS withdrawals(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      withdrawal_id TEXT NOT NULL UNIQUE,
      telegram_id INTEGER NOT NULL,
      wallet_address TEXT NOT NULL,
      amount INTEGER NOT NULL,
      fee_ton REAL NOT NULL DEFAULT 0.1,
      fee_nano TEXT NOT NULL DEFAULT '100000000',
      treasury_wallet TEXT NOT NULL,
      token_contract TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'payment_pending',
      fee_tx_hash TEXT,
      payout_tx_hash TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      verified_at TEXT,
      completed_at TEXT
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS tx_user_idx
    ON transactions(telegram_id)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS task_user_idx
    ON task_claims(telegram_id)
  `);

  console.log('Database initialized');

}

/* =========================================================
   HELPERS
========================================================= */

function referralCode(){

  return 'SNP-'+
    crypto.randomBytes(4)
      .toString('hex')
      .toUpperCase();

}

async function addTransaction(
  telegramId,
  type,
  amount,
  status,
  details=''
){

  await db.execute({
    sql:`
      INSERT INTO transactions
      (telegram_id,type,amount,status,details)
      VALUES(?,?,?,?,?)
    `,
    args:[
      telegramId,
      type,
      amount,
      status,
      details
    ]
  });

}

async function rewardUser(
  telegramId,
  amount,
  type,
  details=''
){

  await db.execute({
    sql:`
      UPDATE users
      SET balance=balance+?
      WHERE telegram_id=?
    `,
    args:[
      amount,
      telegramId
    ]
  });

  await addTransaction(
    telegramId,
    type,
    amount,
    'completed',
    details
  );

}

/* =========================================================
   HEALTH
========================================================= */

app.get('/',(req,res)=>{

  res.json({
    ok:true,
    service:'SINAPS backend',
    database:'Turso',
    status:'online'
  });

});

/* =========================================================
   USER
========================================================= */

app.post('/api/user',async(req,res)=>{

  try{

    const verified=auth(req);

    const telegramId=normalizeId(
      verified?.id||req.body.telegram_id
    );

    if(!telegramId)
      return res.status(401).json({
        error:'Telegram authentication failed'
      });

    const username=
      String(
        verified?.username||
        req.body.username||
        ''
      );

    let result=await db.execute({
      sql:`
        SELECT *
        FROM users
        WHERE telegram_id=?
        LIMIT 1
      `,
      args:[telegramId]
    });

    if(!result.rows.length){

      let code=referralCode();

      await db.execute({
        sql:`
          INSERT INTO users
          (
            telegram_id,
            username,
            balance,
            energy,
            max_energy,
            last_energy_update,
            referral_code
          )
          VALUES(?,?,0,1000,1000,CURRENT_TIMESTAMP,?)
        `,
        args:[
          telegramId,
          username,
          code
        ]
      });

    }else{

      await db.execute({
        sql:`
          UPDATE users
          SET username=?
          WHERE telegram_id=?
        `,
        args:[
          username,
          telegramId
        ]
      });

    }

    result=await db.execute({
      sql:`
        SELECT *
        FROM users
        WHERE telegram_id=?
        LIMIT 1
      `,
      args:[telegramId]
    });

    res.json({
      ok:true,
      user:result.rows[0]
    });

  }catch(e){

    console.error('USER ERROR',e);

    res.status(500).json({
      error:'User request failed'
    });

  }

});

/* =========================================================
   TAP
========================================================= */

app.post('/api/tap',async(req,res)=>{

  try{

    const telegramId=auth(req);

    if(!telegramId)
      return res.status(401).json({
        error:'Unauthorized'
      });

    const result=await db.execute({
      sql:`
        UPDATE users
        SET
          balance=balance+1,
          energy=energy-1
        WHERE telegram_id=?
        AND energy>0
      `,
      args:[telegramId]
    });

    if(result.rowsAffected===0)
      return res.status(400).json({
        error:'Not enough energy'
      });

    const user=await db.execute({
      sql:`
        SELECT *
        FROM users
        WHERE telegram_id=?
      `,
      args:[telegramId]
    });

    res.json({
      ok:true,
      user:user.rows[0]
    });

  }catch(e){

    console.error('TAP ERROR',e);

    res.status(500).json({
      error:'Tap failed'
    });

  }

});

/* =========================================================
   TASKS
========================================================= */

app.get('/api/tasks',async(req,res)=>{

  try{

    const telegramId=auth(req);

    if(!telegramId)
      return res.status(401).json({
        error:'Unauthorized'
      });

    const claims=await db.execute({
      sql:`
        SELECT task_id
        FROM task_claims
        WHERE telegram_id=?
      `,
      args:[telegramId]
    });

    const completed=new Set(
      claims.rows.map(x=>x.task_id)
    );

    const tasks=Object.values(TASKS).map(t=>({

      ...t,

      completed:completed.has(t.id),

      action:
        t.id==='channel'||
        t.id==='group'
        ?'Verify'
        :'Check'

    }));

    res.json({
      ok:true,
      tasks
    });

  }catch(e){

    console.error(e);

    res.status(500).json({
      error:'Tasks failed'
    });

  }

});

/* =========================================================
   CLAIM TASK
========================================================= */

app.post('/api/tasks/claim',async(req,res)=>{

  try{

    const telegramId=auth(req);

    if(!telegramId)
      return res.status(401).json({
        error:'Unauthorized'
      });

    const taskId=String(
      req.body.task_id||''
    );

    const task=TASKS[taskId];

    if(!task)
      return res.status(404).json({
        error:'Task not found'
      });

    const already=await db.execute({
      sql:`
        SELECT id
        FROM task_claims
        WHERE telegram_id=?
        AND task_id=?
        LIMIT 1
      `,
      args:[
        telegramId,
        taskId
      ]
    });

    if(already.rows.length)
      return res.status(400).json({
        error:'Task already completed'
      });

    let verified=false;

    if(taskId==='channel'||taskId==='group'){

      const member=await telegram(
        'getChatMember',
        {
          chat_id:task.chat,
          user_id:telegramId
        }
      );

      verified=
        ['creator','administrator','member']
          .includes(member.status);

    }else if(taskId==='holder'){

      verified=
        await checkSnpBalance(
          req.body.wallet_address||
          ''
        );

    }else if(taskId==='twitter'){

      return res.status(400).json({
        error:'X verification is not configured yet'
      });

    }

    if(!verified){

      return res.status(400).json({
        error:
          'Task not verified. Please complete it and try again.'
      });

    }

    await db.execute({
      sql:`
        INSERT INTO task_claims
        (telegram_id,task_id,reward)
        VALUES(?,?,?)
      `,
      args:[
        telegramId,
        taskId,
        task.reward
      ]
    });

    await rewardUser(
      telegramId,
      task.reward,
      'TASK_REWARD',
      task.title
    );

    const user=await db.execute({
      sql:`
        SELECT balance
        FROM users
        WHERE telegram_id=?
      `,
      args:[telegramId]
    });

    res.json({
      ok:true,
      reward:task.reward,
      balance:user.rows[0].balance
    });

  }catch(e){

    console.error('TASK ERROR',e);

    res.status(400).json({
      error:
        'Verification failed. Please try again.'
    });

  }

});

/* =========================================================
   DAILY STATUS
========================================================= */

app.get('/api/daily/status',async(req,res)=>{

  try{

    const telegramId=auth(req);

    if(!telegramId)
      return res.status(401).json({
        error:'Unauthorized'
      });

    const u=await db.execute({
      sql:`
        SELECT
          daily_streak,
          last_daily_bonus
        FROM users
        WHERE telegram_id=?
      `,
      args:[telegramId]
    });

    const user=u.rows[0];

    const today=new Date()
      .toISOString()
      .slice(0,10);

    let day=Number(
      user?.daily_streak||0
    );

    if(day<1)day=1;

    if(user?.last_daily_bonus===today){

      return res.json({
        ok:true,
        current_day:day,
        claimed:true
      });

    }

    res.json({
      ok:true,
      current_day:day,
      claimed:false
    });

  }catch(e){

    res.status(500).json({
      error:'Daily status failed'
    });

  }

});

/* =========================================================
   DAILY CLAIM
========================================================= */

app.post('/api/daily/claim',async(req,res)=>{

  try{

    const telegramId=auth(req);

    if(!telegramId)
      return res.status(401).json({
        error:'Unauthorized'
      });

    const result=await db.execute({
      sql:`
        SELECT
          daily_streak,
          last_daily_bonus
        FROM users
        WHERE telegram_id=?
      `,
      args:[telegramId]
    });

    if(!result.rows.length)
      return res.status(404).json({
        error:'User not found'
      });

    const u=result.rows[0];

    const today=new Date()
      .toISOString()
      .slice(0,10);

    if(u.last_daily_bonus===today)
      return res.status(400).json({
        error:'Daily reward already claimed'
      });

    let streak=Number(
      u.daily_streak||0
    );

    if(streak<1)
      streak=1;
    else
      streak++;

    if(streak>30)
      streak=1;

    const reward=streak*10;

    await db.execute({
      sql:`
        UPDATE users
        SET
          balance=balance+?,
          daily_streak=?,
          last_daily_bonus=?
        WHERE telegram_id=?
      `,
      args:[
        reward,
        streak,
        today,
        telegramId
      ]
    });

    await addTransaction(
      telegramId,
      'DAILY_REWARD',
      reward,
      `Day ${streak}`
    );

    const user=await db.execute({
      sql:`
        SELECT balance
        FROM users
        WHERE telegram_id=?
      `,
      args:[telegramId]
    });

    res.json({
      ok:true,
      reward,
      day:streak,
      balance:user.rows[0].balance
    });

  }catch(e){

    console.error('DAILY ERROR',e);

    res.status(500).json({
      error:'Daily reward failed'
    });

  }

});

/* =========================================================
   FRIENDS
========================================================= */

app.get('/api/friends',async(req,res)=>{

  try{

    const telegramId=auth(req);

    if(!telegramId)
      return res.status(401).json({
        error:'Unauthorized'
      });

    const me=await db.execute({
      sql:`
        SELECT referral_code
        FROM users
        WHERE telegram_id=?
      `,
      args:[telegramId]
    });

    const friends=await db.execute({
      sql:`
        SELECT
          username,
          balance,
          created_at
        FROM users
        WHERE referred_by=?
        ORDER BY created_at DESC
      `,
      args:[telegramId]
    });

    res.json({
      ok:true,
      referral_code:
        me.rows[0]?.referral_code||'',
      count:friends.rows.length,
      friends:friends.rows
    });

  }catch(e){

    res.status(500).json({
      error:'Friends failed'
    });

  }

});

/* =========================================================
   HISTORY
========================================================= */

app.get('/api/history',async(req,res)=>{

  try{

    const telegramId=auth(req);

    if(!telegramId)
      return res.status(401).json({
        error:'Unauthorized'
      });

    const result=await db.execute({
      sql:`
        SELECT *
        FROM transactions
        WHERE telegram_id=?
        ORDER BY id DESC
        LIMIT 100
      `,
      args:[telegramId]
    });

    res.json({
      ok:true,
      transactions:result.rows
    });

  }catch(e){

    res.status(500).json({
      error:'History failed'
    });

  }

});

/* =========================================================
   WALLET CONNECT
========================================================= */

app.post('/api/wallet/connect',async(req,res)=>{

  try{

    const telegramId=auth(req);

    const wallet=String(
      req.body.wallet_address||''
    ).trim();

    if(!telegramId||!wallet)
      return res.status(400).json({
        error:'Invalid wallet'
      });

    await db.execute({
      sql:`
        UPDATE users
        SET wallet_address=?
        WHERE telegram_id=?
      `,
      args:[
        wallet,
        telegramId
      ]
    });

    res.json({
      ok:true,
      wallet_address:wallet
    });

  }catch(e){

    res.status(500).json({
      error:'Wallet save failed'
    });

  }

});

/* =========================================================
   WALLET GET
========================================================= */

app.post('/api/wallet/get',async(req,res)=>{

  try{

    const telegramId=auth(req);

    if(!telegramId)
      return res.status(401).json({
        error:'Unauthorized'
      });

    const r=await db.execute({
      sql:`
        SELECT wallet_address
        FROM users
        WHERE telegram_id=?
      `,
      args:[telegramId]
    });

    res.json({
      ok:true,
      wallet_address:
        r.rows[0]?.wallet_address||null
    });

  }catch(e){

    res.status(500).json({
      error:'Wallet lookup failed'
    });

  }

});

/* =========================================================
   WITHDRAW CREATE
========================================================= */

app.post('/api/withdraw/create',async(req,res)=>{

  try{

    const telegramId=auth(req);

    const wallet=String(
      req.body.wallet_address||''
    ).trim();

    const amount=Number(
      req.body.amount||0
    );

    if(!telegramId||!wallet||!Number.isSafeInteger(amount)||amount<=0)
      return res.status(400).json({
        error:'Invalid withdrawal'
      });

    const u=await db.execute({
      sql:`
        SELECT *
        FROM users
        WHERE telegram_id=?
      `,
      args:[telegramId]
    });

    if(!u.rows.length)
      return res.status(404).json({
        error:'User not found'
      });

    const user=u.rows[0];

    if(amount>Number(user.balance))
      return res.status(400).json({
        error:'Insufficient SNP balance'
      });

    const id=
      'SNP-'+
      Date.now().toString(36).toUpperCase()+
      '-'+
      crypto.randomBytes(4)
        .toString('hex')
        .toUpperCase();

    await db.execute({
      sql:`
        INSERT INTO withdrawals
        (
          withdrawal_id,
          telegram_id,
          wallet_address,
          amount,
          fee_ton,
          fee_nano,
          treasury_wallet,
          token_contract,
          status
        )
        VALUES(?,?,?,?,0.1,?,?,?,'payment_pending')
      `,
      args:[
        id,
        telegramId,
        wallet,
        amount,
        FEE_NANO,
        TREASURY_WALLET,
        SNP_CONTRACT
      ]
    });

    await addTransaction(
      telegramId,
      'WITHDRAWAL',
      -amount,
      'Processing',
      id
    );

    res.json({
      ok:true,
      withdrawal_id:id,
      amount,
      fee_nano:FEE_NANO,
      treasury_wallet:TREASURY_WALLET,
      token_contract:SNP_CONTRACT,
      status:'payment_pending'
    });

  }catch(e){

    console.error('WITHDRAW CREATE',e);

    res.status(500).json({
      error:'Withdrawal creation failed'
    });

  }

});

/* =========================================================
   WITHDRAW VERIFY
========================================================= */

app.post('/api/withdraw/verify',async(req,res)=>{

  try{

    const telegramId=auth(req);

    const id=String(
      req.body.withdrawal_id||''
    ).trim();

    if(!telegramId||!id)
      return res.status(400).json({
        error:'Invalid withdrawal'
      });

    const r=await db.execute({
      sql:`
        SELECT *
        FROM withdrawals
        WHERE withdrawal_id=?
        AND telegram_id=?
      `,
      args:[
        id,
        telegramId
      ]
    });

    if(!r.rows.length)
      return res.status(404).json({
        error:'Withdrawal not found'
      });

    res.json({
      ok:true,
      status:r.rows[0].status,
      withdrawal:r.rows[0]
    });

  }catch(e){

    res.status(500).json({
      error:'Verification failed'
    });

  }

});

/* =========================================================
   SNP BALANCE CHECK
========================================================= */

async function checkSnpBalance(wallet){

  if(!wallet)
    return false;

  try{

    const url=
      TONCENTER+
      '/jetton/wallets?address='+
      encodeURIComponent(wallet)+
      '&jetton_address='+
      encodeURIComponent(SNP_CONTRACT);

    const r=await fetch(
      url,
      {
        headers:
          TONCENTER_API_KEY
          ? {'X-API-Key':TONCENTER_API_KEY}
          : {}
      }
    );

    if(!r.ok)return false;

    const d=await r.json();

    const rows=
      d.jetton_wallets||
      d.wallets||
      d.result||
      [];

    for(const x of rows){

      const raw=
        Number(
          x.balance||
          x.jetton_balance||
          0
        );

      if(raw>=50000*1e9)
        return true;

    }

    return false;

  }catch(e){

    console.error(
      'SNP BALANCE CHECK',
      e
    );

    return false;
  }

}

/* =========================================================
   START
========================================================= */

async function start(){

  try{

    await initDatabase();

    app.listen(PORT,()=>{
      console.log(
        `SINAPS backend running on port ${PORT}`
      );
    });

  }catch(e){

    console.error(
      'STARTUP ERROR',
      e
    );

    process.exit(1);
  }

}

start();
