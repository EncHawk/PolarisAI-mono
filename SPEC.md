## Story line
the idea is to have an agent that implements a research paper, takes a vague input of a technical report or a structured paper from arxiv to both read 
and understand what the paper does. 
the intent behind all this is to automate proof-ing the paper's claimed numbers, both graphs or quoted benchmark numbers(this might be for us to figure out later)

# Architecture : 
a monorepo with three dirs, backend client and a worker. the worker is gona run agents to implement a research paper's ideas and transform it into code in python (PyTorch in specific)
here's the first set of tasks : 
the basic logic for; login signin signup all must be included with proper frontend integrations too. use google's oauth (oatuh config json is pasted) services for this and next-auth on the frontend.

a FastAPI backend with native rate limiting with basic in-memory cache to see if there's a user already there in under a TTS. 
an /ingest endpoint to ingest either the pdf from arxiv or the arxiv url/id from the user. that's where we start. ingest using llamaindex( returning markdown) this should return a token maybe a global uuid.
that we use to track the progress of the worker. as soon as we hit /ingest we need to start the worker to go through a set of agents (defined below).

then /events : this will return the events from the worker, maybe a redis list to see what the agent is doing, i.e the thinking trails of the agent. an SSE will stream the events to the frontend and a clean interface on the next app will show the agent's traces. This will stream from the global uuid from the /ingest

and finally a /list which will list all the specific papers the user has gone through


we're gonna run supabase for the user's details : user schema : 
username, email, password(bcrypt salted version), github and X usernames. 


## Agents involved:
all the agent's traces must be logged, what the agent's step is, what tool its using, what it concluded (not raw thinking statements) include an output query from the agent to see what progress its upto
all these are loops until the model thinks its ready. then we use the orchestrating agent to verify if its good enough to move to the next agent.

built with langgraph, and deepinfra for the model inference providers. 
the worker will have the following agents :
READ => which will read the research paper's contents and return the following : 
what do they aim to solve ?
what they built on top of ?
what experiments or ablation studies or misc studies have they done and what was yielded from it?
what novel approach have they introduced and is this codeable or not?
what numbers (imporvements or demotional) have they proposed ?
waht are the most relevant citations they're using ? => useful for the research agent

RESEARCH => 
this agent will go through all the citations and bring in their technical implementations
what does a citation paper do and claim (essentially a very vague READ but not using READ)?
how does this paper use that citation? 
--more scope later--

PLAN =>
this agent will come up with the plan for the coding agent, once this one has a plan we get the user's approval and integrate their changes if any and then move on
what does the paper intend to prove?
how do they claim of prooving it?
what does the researched papers usage look like?
what changes have they done to the basic paper?
are they using custom kernels, if yes-> more details?

plan() => create a todo list for the coding model to build


CODE =>
this is the agent that will code, its task is to run a loop like other agents too 
this agent will have access to a sandbox (daytona) and write code using their sdk and read those logs accordingly 
write files that do one thing and one thing only, implement everthing in pytorch or jsut raw python if its asked about. 


