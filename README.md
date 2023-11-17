# SDXL - Websocket

https://github.com/jimgoo/sdxl-websocket/assets/2735842/66144701-9e4f-4303-9aff-67c4c7d995a6

## Backend

### Install
```
conda env create -f environment.yaml -n sdxl-websocket
conda activate sdxl-websocket
```

### Run
```
uvicorn backend:app --host 0.0.0.0 --port 50217 --reload
```

## Frontend

### Install
```
npm install
```

### Run
```
npm start
```

## Motivation

As the MidJourney Discord bot is generating images for your prompt over some number of diffusion steps, it makes the wait time a little more enjoyable by showing you your images at the current step. The video below demonstrates the user experience for the prompt 'A fox in a misty forest', showcasing the image generation process:

https://github.com/jimgoo/sdxl-websocket/assets/2735842/719260c1-3222-487e-9ca5-ea45cf1f68b7

If you count them there are eight incremental updates where the images change. I found that each of the four images during incremental updates is 256 x 256, then in the last update the size is 1024 x 1024. One run takes about 30 seconds on average for my account with the $10/month plan.

Knowing that WebSockets were the best way to achieve this, I was surprised to find that the paid StabilityAI stable diffusion API did not offer a WebSocket API. In fact, I didn't find any paid services that had a WebSocket API and also didn't find any code on GitHub implementating a simple version of it. So I built a frontend and backend and open sourced the code here.

## Frontend (React)

The frontend is built using React and Material-UI components. Key features include:

- User Interface: The interface includes a text field for users to enter prompts, a button to initiate image generation, and components to display the progress and results. Images are displayed in an ImageList from Material-UI.
- WebSocket Communication: The frontend connects to a WebSocket server at `ws://localhost:50217/images/generate-ws`. It sends the user's prompt and other parameters (like image size, steps, seed, etc.) to the backend and receives the generated images or progress updates.
- Error Handling: The application includes a Snackbar for displaying error messages if something goes wrong during the image generation process.
- Image Viewing: Users can click on thumbnails to view the full-sized generated images in a modal.


## Backend (FastAPI)

The backend is developed using FastAPI and is responsible for handling the image generation process:

- WebSocket Endpoint: The `/images/generate-ws` WebSocket endpoint accepts connections from the frontend. It receives the payload from the client, which includes the prompt and image generation parameters.
- Image Generation Model: The backend uses the `DiffusionPipeline` from the diffusers library, specifically the `stable-diffusion-xl-base-1.0` model for image generation. I chose these because SDXL is a great general purpose model for 1024 x 1024 images and diffusers will let me easily switch to future models down the road.
- Processing and Callbacks: The backend processes the prompts and generates images in steps. Callbacks are used for each step to update the client on the progress. Images are either sent as binary or base64 encoded strings, depending on the payload's use_binary flag.

I originally tried to use the `callback` argument of the `DiffusionPipeline` to send progress updates to the client, but despite many rounds with ChatGPT, could not get it to work since the callback method had to be synchronous. I ended up having to make a custom version of the diffusers SDXL pipeline [`__call__` method](https://github.com/huggingface/diffusers/blob/73bb97adfc3d0cb184c5fd66a1d5699c249a7fd8/src/diffusers/pipelines/stable_diffusion_xl/pipeline_stable_diffusion_xl.py#L543) to decode the latents into images on certain steps and send the images to the client. SDXL generates good images with 40 steps, so to mirror the eight updates done by MidJourney, I send image updates to the client every five steps.

I found that the message size for a grid of four 1024 x 1024 images was so large that sending it on multiple steps was slowing everything down too much. A little reverse engineering revealed that the size of MidJourney's incremental images is 256 x 256, and once I resized all but the final images to that size, the message size was much more manageable and things ran faster. Since the final step still needs to send the full resolution images, I used MessagePack for all messages to reduce the size of all data being sent over the WebSocket.

I ran the backend on an NVIDIA A6000 GPU during testing and found that a MidJourney-style grid of four images with eight incremental updates at size 256 x 256 and a final update at 1024 x 1024 takes about 45 seconds. MidJourney runs a little faster at 30 seconds, possibly due to the fact that they are using better GPUs. I think MidJourney is also using a different schedule for the incremental updates, since their images look further along in steps when the first one is shown. I added a parameter called `callback_start` that defaults to 0 but can be set to a higher number to skip the first few steps and start the incremental updates later.
