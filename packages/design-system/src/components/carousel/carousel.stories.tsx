'use client';

import * as React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Carousel, CarouselContent, CarouselItem, CarouselPrevious, CarouselNext, type CarouselApi } from './';
import { Card, CardContent } from '../card';

const meta: Meta<typeof Carousel> = {
	title: 'Components/Carousel',
	component: Carousel,
	tags: ['autodocs'],
	parameters: {
		docs: {
			description: {
				component:
					'A carousel component built on embla-carousel-react. Supports horizontal and vertical orientations, custom Embla options/plugins, and provides previous/next navigation buttons. Use `setApi` to access the underlying Embla API for custom slide control.',
			},
		},
	},
	argTypes: {
		orientation: {
			control: 'select',
			options: ['horizontal', 'vertical'],
			description: 'The scroll axis direction',
		},
		opts: { control: 'object' },
	},
};

export default meta;
type Story = StoryObj<typeof Carousel>;

export const Default: Story = {
	render: () => (
		<div className="w-full max-w-sm">
			<Carousel>
				<CarouselContent>
					{Array.from({ length: 5 }).map((_, i) => (
						<CarouselItem key={i}>
							<Card>
								<CardContent className="flex aspect-square items-center justify-center p-6">
									<span className="text-4xl font-semibold">{i + 1}</span>
								</CardContent>
							</Card>
						</CarouselItem>
					))}
				</CarouselContent>
				<CarouselPrevious />
				<CarouselNext />
			</Carousel>
		</div>
	),
	parameters: {
		layout: 'centered',
	},
};

export const WithCustomOpts: Story = {
	render: () => (
		<div className="w-full max-w-sm">
			<Carousel
				opts={{
					loop: true,
					dragFree: true,
					align: 'start',
				}}
			>
				<CarouselContent>
					{Array.from({ length: 8 }).map((_, i) => (
						<CarouselItem key={i} className="basis-1/2 md:basis-1/3">
							<Card>
								<CardContent className="flex aspect-square items-center justify-center p-6">
									<span className="text-4xl font-semibold">{i + 1}</span>
								</CardContent>
							</Card>
						</CarouselItem>
					))}
				</CarouselContent>
				<CarouselPrevious />
				<CarouselNext />
			</Carousel>
		</div>
	),
	parameters: {
		layout: 'centered',
	},
};

export const WithSlideIndicator: Story = {
	render: () => {
		const [api, setApi] = React.useState<CarouselApi>();
		const [current, setCurrent] = React.useState(0);
		const [count, setCount] = React.useState(0);

		React.useEffect(() => {
			if (!api) return;
			setCount(api.scrollSnapList().length);
			setCurrent(api.selectedScrollSnap());

			api.on('select', () => {
				setCurrent(api.selectedScrollSnap());
			});
		}, [api]);

		return (
			<div className="w-full max-w-sm space-y-2">
				<Carousel setApi={setApi}>
					<CarouselContent>
						{Array.from({ length: 5 }).map((_, i) => (
							<CarouselItem key={i}>
								<Card>
									<CardContent className="flex aspect-square items-center justify-center p-6">
										<span className="text-4xl font-semibold">{i + 1}</span>
									</CardContent>
								</Card>
							</CarouselItem>
						))}
					</CarouselContent>
					<CarouselPrevious />
					<CarouselNext />
				</Carousel>
				<div className="text-center text-sm text-muted-foreground">
					Slide {current + 1} of {count}
				</div>
			</div>
		);
	},
	parameters: {
		layout: 'centered',
	},
};
