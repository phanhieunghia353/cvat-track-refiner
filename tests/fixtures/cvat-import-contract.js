// Copyright (C) 2019-2022 Intel Corporation
// Copyright (C) CVAT.ai Corporation
// SPDX-License-Identifier: MIT
// Exact method body from cvat-core/src/annotations-collection.ts, develop.
// Extracted for testing only; factories provide model stubs, not a hosted CVAT.
export function upstreamImport(data, {Tag,shapeFactory,trackFactory,AudioInterval,colors}) {
        const result = {
            tags: [],
            shapes: [],
            tracks: [],
            intervals: [],
        };

        for (const tag of data.tags ?? []) {
            const clientID = this.injection.nextClientID();
            const color = colors[clientID % colors.length];
            const tagModel = new Tag(tag, clientID, color, this.injection);
            this.tags[tagModel.frame] = this.tags[tagModel.frame] || [];
            this.tags[tagModel.frame].push(tagModel);
            this.objects[clientID] = tagModel;

            result.tags.push(tagModel);
        }

        for (const shape of data.shapes ?? []) {
            const clientID = this.injection.nextClientID();
            const shapeModel = shapeFactory(shape, clientID, this.injection);
            this.shapes[shapeModel.frame] = this.shapes[shapeModel.frame] || [];
            this.shapes[shapeModel.frame].push(shapeModel);
            this.objects[clientID] = shapeModel;

            result.shapes.push(shapeModel);
        }

        for (const track of data.tracks ?? []) {
            const clientID = this.injection.nextClientID();
            const trackModel = trackFactory(track, clientID, this.injection);
            // The function can return null if track doesn't have any shapes.
            // In this case a corresponded message will be sent to the console
            if (trackModel) {
                this.tracks.push(trackModel);
                result.tracks.push(trackModel);
                this.objects[clientID] = trackModel;
            }
        }

        for (const interval of data.intervals ?? []) {
            const clientID = this.injection.nextClientID();
            const color = colors[clientID % colors.length];
            const intervalModel = new AudioInterval(interval, clientID, color, this.injection);
            this.intervals.push(intervalModel);
            this.objects[clientID] = intervalModel;
            result.intervals.push(intervalModel);
        }

        return result;
}
