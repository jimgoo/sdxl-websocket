import logging
import time

# web
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import msgpack

# model
import torch
from diffusers import DiffusionPipeline
from diffusers.pipelines.stable_diffusion_xl.pipeline_stable_diffusion_xl import rescale_noise_cfg

# images
from PIL import Image
import base64
from io import BytesIO

logging.basicConfig(
    format="%(asctime)s - %(levelname)s - %(name)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    level=logging.INFO,
)

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class TextToImagePayload(BaseModel):
    use_binary: bool
    engine: str
    steps: int
    width: int
    height: int
    seed: int
    cfg_scale: float
    samples: int
    text_prompts: list
    callback_steps: int
    callback_start: int

pipe = DiffusionPipeline.from_pretrained(
    "stabilityai/stable-diffusion-xl-base-1.0",
    torch_dtype=torch.float16,
    use_safetensors=True, 
    variant="fp16",
).to("cuda")


@app.websocket("/images/generate-ws")
async def generate_images_ws(
    websocket: WebSocket,
):
    logging.info('generate websocket: %s', websocket)

    await websocket.accept()
    
    # Receive payload as first message
    payload = await websocket.receive_json()
    payload = TextToImagePayload(**payload)
    logging.info('generate payload: %s', payload)

    def image_to_base64(image: Image):
        buffered = BytesIO()
        image.save(buffered, format="JPEG")
        return base64.b64encode(buffered.getvalue()).decode("utf-8")

    def image_to_binary(image: Image):
        buffer = BytesIO()
        image.save(buffer, format="JPEG")
        return buffer.getvalue()

    def callback(step: int, timestep: int, latents: torch.FloatTensor, is_last: bool):
        start_time = time.time()
    
        # make sure the VAE is in float32 mode, as it overflows in float16
        needs_upcasting = pipe.vae.dtype == torch.float16 and pipe.vae.config.force_upcast

        if needs_upcasting:
            pipe.upcast_vae()
            latents = latents.to(next(iter(pipe.vae.post_quant_conv.parameters())).dtype)

        image = pipe.vae.decode(latents / pipe.vae.config.scaling_factor, return_dict=False)[0]

        # cast back to fp16 if needed
        if needs_upcasting:
            pipe.vae.to(dtype=torch.float16)
    
        # apply watermark if available
        if pipe.watermark is not None:
            image = pipe.watermark.apply_watermark(image)

        # a list of images
        image = pipe.image_processor.postprocess(image, output_type='pil')
        
        # resize images if it's not the last step for speed
        if not is_last:
            # this is the size used by MidJourney progress images
            size = (256, 256)
            for img in image:
                img.thumbnail(size)

        if payload.use_binary:
            artifacts = [image_to_binary(x) for x in image]
        else:
            artifacts = [{'base64': image_to_base64(x)} for x in image]
        update = {
            "step": step,
            "artifacts": artifacts, 
        }
        logging.info('callback: step %s, is_last: %s, time: %.2f sec', update['step'], is_last, time.time() - start_time)

        return update

    positive_prompts = [x['text'] for x in payload.text_prompts if x['weight'] > 0]
    negative_prompts = [x['text'] for x in payload.text_prompts if x['weight'] < 0]
    
    # https://github.com/huggingface/diffusers/blob/73bb97adfc3d0cb184c5fd66a1d5699c249a7fd8/src/diffusers/pipelines/stable_diffusion_xl/pipeline_stable_diffusion_xl.py
    prompt = positive_prompts
    prompt_2 = None
    height = payload.height
    width = payload.width
    num_inference_steps = payload.steps
    denoising_end = None
    guidance_scale = payload.cfg_scale
    negative_prompt = negative_prompts
    negative_prompt_2 = None
    num_images_per_prompt = payload.samples
    eta = 1.0
    generator = torch.Generator(device="cuda").manual_seed(payload.seed) if payload.seed > 0 else None
    latents = None
    prompt_embeds = None
    negative_prompt_embeds = None
    pooled_prompt_embeds = None
    negative_pooled_prompt_embeds = None
    callback_steps = payload.callback_steps
    cross_attention_kwargs = None
    guidance_rescale = 0.0
    original_size = None
    crops_coords_top_left = (0, 0)
    target_size = None
    negative_original_size = None
    negative_crops_coords_top_left = (0, 0)
    negative_target_size = None

    with torch.no_grad():
        # 0. Default height and width to unet
        height = height or pipe.default_sample_size * pipe.vae_scale_factor
        width = width or pipe.default_sample_size * pipe.vae_scale_factor

        original_size = original_size or (height, width)
        target_size = target_size or (height, width)

        # 1. Check inputs. Raise error if not correct
        pipe.check_inputs(
            prompt,
            prompt_2,
            height,
            width,
            callback_steps,
            negative_prompt,
            negative_prompt_2,
            prompt_embeds,
            negative_prompt_embeds,
            pooled_prompt_embeds,
            negative_pooled_prompt_embeds,
        )

        # 2. Define call parameters
        if prompt is not None and isinstance(prompt, str):
            batch_size = 1
        elif prompt is not None and isinstance(prompt, list):
            batch_size = len(prompt)
        else:
            batch_size = prompt_embeds.shape[0]

        device = pipe._execution_device

        # here `guidance_scale` is defined analog to the guidance weight `w` of equation (2)
        # of the Imagen paper: https://arxiv.org/pdf/2205.11487.pdf . `guidance_scale = 1`
        # corresponds to doing no classifier free guidance.
        do_classifier_free_guidance = guidance_scale > 1.0

        # 3. Encode input prompt
        text_encoder_lora_scale = (
            cross_attention_kwargs.get("scale", None) if cross_attention_kwargs is not None else None
        )
        (
            prompt_embeds,
            negative_prompt_embeds,
            pooled_prompt_embeds,
            negative_pooled_prompt_embeds,
        ) = pipe.encode_prompt(
            prompt=prompt,
            prompt_2=prompt_2,
            device=device,
            num_images_per_prompt=num_images_per_prompt,
            do_classifier_free_guidance=do_classifier_free_guidance,
            negative_prompt=negative_prompt,
            negative_prompt_2=negative_prompt_2,
            prompt_embeds=prompt_embeds,
            negative_prompt_embeds=negative_prompt_embeds,
            pooled_prompt_embeds=pooled_prompt_embeds,
            negative_pooled_prompt_embeds=negative_pooled_prompt_embeds,
            lora_scale=text_encoder_lora_scale,
        )

        # 4. Prepare timesteps
        pipe.scheduler.set_timesteps(num_inference_steps, device=device)

        timesteps = pipe.scheduler.timesteps

        # 5. Prepare latent variables
        num_channels_latents = pipe.unet.config.in_channels
        latents = pipe.prepare_latents(
            batch_size * num_images_per_prompt,
            num_channels_latents,
            height,
            width,
            prompt_embeds.dtype,
            device,
            generator,
            latents,
        )

        # 6. Prepare extra step kwargs. TODO: Logic should ideally just be moved out of the pipeline
        extra_step_kwargs = pipe.prepare_extra_step_kwargs(generator, eta)

        # 7. Prepare added time ids & embeddings
        add_text_embeds = pooled_prompt_embeds
        add_time_ids = pipe._get_add_time_ids(
            original_size, crops_coords_top_left, target_size, dtype=prompt_embeds.dtype
        )
        if negative_original_size is not None and negative_target_size is not None:
            negative_add_time_ids = pipe._get_add_time_ids(
                negative_original_size,
                negative_crops_coords_top_left,
                negative_target_size,
                dtype=prompt_embeds.dtype,
            )
        else:
            negative_add_time_ids = add_time_ids

        if do_classifier_free_guidance:
            prompt_embeds = torch.cat([negative_prompt_embeds, prompt_embeds], dim=0)
            add_text_embeds = torch.cat([negative_pooled_prompt_embeds, add_text_embeds], dim=0)
            add_time_ids = torch.cat([negative_add_time_ids, add_time_ids], dim=0)

        prompt_embeds = prompt_embeds.to(device)
        add_text_embeds = add_text_embeds.to(device)
        add_time_ids = add_time_ids.to(device).repeat(batch_size * num_images_per_prompt, 1)

        # 8. Denoising loop
        num_warmup_steps = max(len(timesteps) - num_inference_steps * pipe.scheduler.order, 0)

        # 7.1 Apply denoising_end
        if denoising_end is not None and isinstance(denoising_end, float) and denoising_end > 0 and denoising_end < 1:
            discrete_timestep_cutoff = int(
                round(
                    pipe.scheduler.config.num_train_timesteps
                    - (denoising_end * pipe.scheduler.config.num_train_timesteps)
                )
            )
            num_inference_steps = len(list(filter(lambda ts: ts >= discrete_timestep_cutoff, timesteps)))
            timesteps = timesteps[:num_inference_steps]

        with pipe.progress_bar(total=num_inference_steps) as progress_bar:
            for i, t in enumerate(timesteps):
                # expand the latents if we are doing classifier free guidance
                latent_model_input = torch.cat([latents] * 2) if do_classifier_free_guidance else latents

                latent_model_input = pipe.scheduler.scale_model_input(latent_model_input, t)

                # predict the noise residual
                added_cond_kwargs = {"text_embeds": add_text_embeds, "time_ids": add_time_ids}
                noise_pred = pipe.unet(
                    latent_model_input,
                    t,
                    encoder_hidden_states=prompt_embeds,
                    cross_attention_kwargs=cross_attention_kwargs,
                    added_cond_kwargs=added_cond_kwargs,
                    return_dict=False,
                )[0]

                # perform guidance
                if do_classifier_free_guidance:
                    noise_pred_uncond, noise_pred_text = noise_pred.chunk(2)
                    noise_pred = noise_pred_uncond + guidance_scale * (noise_pred_text - noise_pred_uncond)

                if do_classifier_free_guidance and guidance_rescale > 0.0:
                    # Based on 3.4. in https://arxiv.org/pdf/2305.08891.pdf
                    noise_pred = rescale_noise_cfg(noise_pred, noise_pred_text, guidance_rescale=guidance_rescale)

                # compute the previous noisy sample x_t -> x_t-1
                latents = pipe.scheduler.step(noise_pred, t, latents, **extra_step_kwargs, return_dict=False)[0]

                # call the callback, if provided
                if i == len(timesteps) - 1 or ((i + 1) > num_warmup_steps and (i + 1) % pipe.scheduler.order == 0):
                    progress_bar.update()
                    is_last = i == len(timesteps) - 1
                    # if it's the last step or if we have gone further than callback_start and are on a callback step
                    update = None
                    if is_last or ((i + 1 >= payload.callback_start) and (i % callback_steps == 0)):
                        # Diffusers makes call: `callback(i, t, latents)`
                        update = callback(i, t, latents, is_last)
                    else:
                        # just a step to indicate progress without sending any images
                        update = {"step": i}
                    # send update to client
                    if update is not None:
                        if payload.use_binary:
                            await websocket.send_bytes(msgpack.packb(update, use_bin_type=True))
                        else:
                            await websocket.send_json(update)
