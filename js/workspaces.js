const SUMMARY_LENGTH = 200

var preventEditorFlush

function toHTML(text) {
	// TODO : full HTML entities support (with RE extraction loop and one to one hash)
	return text.replace(/\n/g, '<br>').replace(/ /g, '&nbsp;')
}
function fromHTML(html) {
	// TODO : full HTML entities support
	return html.replace(/<br>/g, '\n').replace(/&nbsp;/g, ' ')
}

function indexOfNode(node) {
	return Array.prototype.indexOf.call(node.parentNode.childNodes, node)
}

function nodeText(node, start, end) {
	if (node.nodeType === 3) {
		return node.textContent.substring(start, end)
	}
	if (node.nodeType === 1) {
		if (node.nodeName === 'BR') {
			return '\n'
		}
		var text = ''
		var childNodes = node.childNodes
		var i = start || 0
		var len = end ? Math.min(end, childNodes.length) : childNodes.length
		while (i < len) {
			text += nodeText(childNodes[i++])
		}
		return text
	}
	return ''
}

function nodeOffset(node, position) {
	var offset = 0
	if (node.nodeType === 3) {
		offset = position
		position = indexOfNode(node)
		node = node.parentNode
	}
	var siblings = node.childNodes
	for (var i = 0; i < position; i++) {
		node = siblings[i]
		offset += nodeText(node).length
	}
	return offset
}

var currentSelection = ko.observable()
function checkSelection(e) {
	if (e.type === 'keyup' && !e.key.startsWith('Arrow')) {
		return true;
	}

	var editor = this
	setTimeout(function() {
		var selection = document.getSelection()
		if (selection) {

			if (selection.isCollapsed || selection.rangeCount > 1) {
				// discard: a) 0 width selection, b) multiple selections
				return void currentSelection(null)
			}

			var range = selection.getRangeAt(0)
			
			var commonAncestor = range.commonAncestorContainer
			if (!editor.contains(commonAncestor)) {
				// discard selections lying out of the editor
				return void currentSelection(null)
			}

			// handle limit boundaries : <TextNode xxx|></span>, <br>|</span>, <span><TextNode |xxx>, <span>|<br>
			var startNode = range.startContainer
			var startOffset = range.startOffset
			if (startNode.nodeType === 3 && startNode.textContent.length === startOffset) {
				// <TextNode xxx|><xxx/> => <TextNode xxx>|<xxx/>
				startOffset = indexOfNode(startNode) + 1
				startNode = startNode.parentNode
			}
			if (startNode.childNodes.length === startOffset) {
				// <xxx/>|</span> => </span><span>|
				var next = startNode.nextElementSibling
				if (next) {
					startNode = next
					startOffset = 0
				}
			}
			range.setStart(startNode, startOffset)

			var endNode = range.endContainer
			var endOffset = range.endOffset
			if (endNode.nodeType === 3 && endOffset === 0) {
				// <xxx/><TextNode |xxx> => <xxx/>|<TextNode xxx>
				endOffset = indexOfNode(endNode)
				endNode = endNode.parentNode
			}
			if (endOffset === 0) {
				// <span>|<xxx/> => |</span><span>
				var prev = endNode.previousElementSibling
				if (prev) {
					endNode = prev
					endOffset = endNode.childNodes.length
				}
			}
			range.setEnd(endNode, endOffset)

			if (selection.isCollapsed) {
				// at this point the selection could have collapsed!!!
				return void currentSelection(null)
			}

			// discard selections including already selected spans
			if (commonAncestor.nodeType === 3) {
				commonAncestor = commonAncestor.parentElement
			}
			if (commonAncestor.classList.contains('desex-selection')) {
				// not valid if the common ancestor is a selection span
				return void currentSelection(null)
			}

			// clone range nodes into a new DocumentFragment and check if it contains a selection
			var rangeNodes = range.cloneContents()
			if (rangeNodes.querySelector('.desex-selection')) {
				return void currentSelection(null)
			}
		}
	}, 0)

	return true
}
$('#desex_test').on('mouseup keyup', '.desex-editor', checkSelection) // TODO : fix mouseup fuori dal riquadro

var selectionTools, clickedSelection
$('#desex_test').on('mousedown keydown', '.desex-selection', function(e) {
	var id = this.id
	if (selectionTools) {
		if (id === clickedSelection.id) {
			return
		}
		selectionTools.hide()
	}
	clickedSelection = editor.entity().selections().find(function(s) { return s.id === id })
	selectionTools = $('.desex-selection-tools', this).css('display', 'inline-block')
	e.stopPropagation()
})
$('#desex_test').on('mousedown keydown', '.desex-editor', function() {
	if (selectionTools) {
		selectionTools.hide()
		clickedSelection = null
		selectionTools = null
	}
})

var _entityUID = 0
function Entity(opts) {
	opts = opts || {}
	if (typeof opts === 'string') {
		opts = { name : opts }
	}

	var id = this.id = ++_entityUID
	this.name = ko.observable(opts.name || '')
	this.description = opts.description || ''

	var summary = ko.observable(opts.summary)
	this.summary = ko.computed({
		owner : this,
		read : function() {
			if (summary()) {
				return summary()
			}
			var description = this.description
			var paragraphEnd = description.indexOf('\n')
			if (paragraphEnd === -1) {
				return description
			} else {
				return description.substring(0, paragraphEnd)
			}
		},
		write : function(newValue) {
			summary(newValue)
		}
	})

	var self = this, _sorting

	var _selectionUID = 0
	this.selections = ko.observableArray()
	this.selections.subscribe(function() {
		if (!_sorting) {
			_sorting = true
			self.selections.sort(function(a, b) { return a.start - b.start })
			_sorting = false
		}
	})
	this.select = function(start, end, name) {
		var selId = 'desex_selection_' + id + '_' + (++_selectionUID)
		self.selections.push({ id : selId, name : name || '', start : start, end : end })
	}
	if (opts.selections) {
		var selections = opts.selections
		for (var i = 0; i < selections.length; i++) {
			var sel = selections[i]
			this.select(sel.start, sel.end, sel.name)
		}
	}

}

function Editor(opts) {
	opts = opts || {}

	this.mode = ko.observable(opts.mode || 'describe')
	
	var entity = opts.entity
	var etype = typeof entity
	if (etype === 'string' || etype === 'object' && !(entity instanceof Entity)) {
		entity = new Entity(entity)
	} else if (etype !== 'object') {
		entity = new Entity
	}
	this.entity = ko.observable(entity)

	var self = this
	this.pieces = ko.computed(function() {
		var pieces = []
		var index = 0

		var entity = self.entity()
		var id = entity.id
		var description = entity.description
		var selections = entity.selections()
		
		for (var i = 0, l = selections.length; i < l; i++) {
			var sel = selections[i]
			var leading = toHTML( description.substring(index, sel.start) )
			pieces.push({ id : 'desex_free_' + id + '_' + i, template : 'desex_plain_text', html : leading })
			var selected = toHTML( description.substring(sel.start, sel.end) )
			pieces.push({ id : sel.id, template : 'desex_selection', html : selected, name : sel.name, xxx : function() { alert(sel.name) } })
			index = sel.end
		}
		var trailing = toHTML( description.substring(index) )
		if (trailing) {
			pieces.push({ id : 'desex_free_' + id + '_' + i, template : 'desex_plain_text', html : trailing })
		}

		return pieces
	})

	this.markSelection = function markSelection() {
		var selection = currentSelection()
		if (selection) {
			var range = selection.getRangeAt(0)

			// let's find the start index of the selection in the text
			var startNode = range.startContainer
			var startOffset = range.startOffset
			// first off we compute the offset relative to the immediate parent element
			var start = nodeOffset(startNode, startOffset)
			if (startNode.nodeType === 3) {
				
			}

			var editorElements = document.getElementsByClassName('desex-editor')[0].children
			for (var i = 0, len = editorElements.length; i < len; i++) {
				var node = editorElements[i]
				if (node.classList.contains('desex-selection')) {
					node = node.firstChild
				}
				if (node === startContainer) {
					console.log(nodeText(node, 0, range.startOffset))
					break
				}
				console.log(nodeText(node))
			}

			console.log(container, range.startOffset)
			var offset = 0
			if (container.nodeType === 3) {
				offset = range.startOffset
				var prev = container.previousSibling
				for (var node = container; node = node.previousSibling;) {
					if (text.tagName === 'BR') {
						offset++
					} else if (text.nodeType === 3) {
						offset += text.textContent.length
					}
				}
			} else if (container.nodeName === 'span') {
			}
			for (var span = container.parentElement; span = span.previousElementSibling;) {
				var length = fromHTML( span.innerHTML ).length
				offset += length
			}
			var start = offset + range.startOffset
			var end = offset
			var endContainer = range.endContainer
			if (endContainer.tagName === 'SPAN') {
				endContainer = endContainer.children[range.endOffset - 1]
			} else {
				end += range.endOffset
			}
			while (container && container !== endContainer) {
				if (container.tagName === 'BR') {
					end++
				} else if (container.nodeType === 3) {
					end += container.textContent.length
				}
				container = container.nextSibling
			}

			self.entity().select(start, end)

			selection.removeAllRanges()
			currentSelection(null)
			preventEditorFlush = true
		}
	}
}

var editor = new Editor({
	entity : {
		description : 'miao miao miao\n\nmiao bau bau\nqua qua\ncicì cocò',
		selections : [
			{name:'Miao',start:5,end:9},
			{name:'Bau',start:12,end:14}
		]
	}
})
ko.applyBindings(editor, document.getElementById('desex_test'))

$('#desex_test .desex-editor').on('paste', cleanInput)
function cleanInput(e) {
	e.preventDefault()
	e = e.originalEvent
	var htmlData = e.clipboardData.getData('text/html')
	if (htmlData) {
		var iframe = (new DOMParser).parseFromString(htmlData, 'text/html')
		var body = $(iframe.body)
		if (body.children().length) {
			htmlData = body.children()
		}
		var shouldBreak = false
		var content = $(htmlData).map(function() {
			var $this = $(this)
			if ($this.is('p,div')) {
				if (shouldBreak) {
					return '<br>' + $this.contents().map(stripInnerTags).get().join('')
				} else {
					shouldBreak = true
					return $this.contents().map(stripInnerTags).get().join('')
				}
			}
			return $this.html()
		})
		document.execCommand('insertHTML', false, content.get().join(''))

	} else {
		var textData = e.clipboardData.getData('text/plain')
		if (textData) {
			document.execCommand('insertHTML', false, toHTML( textData ))
		}
	}
}
function stripInnerTags() {
	if (this.nodeType === 3) {
		return this.textContent
	}
	if ($(this).is('br')) {
		return '<br>'
	}
	return $(this).html()
}

var order = 0
var observer = new MutationObserver(function(records) {

	if (preventEditorFlush) {
		preventEditorFlush = false
		return
	}
	
	// TODO : handle inner text drag and drop, selection deletion

	order++
	var targets = records.map(function(r) {
		return [order, r.type, r.target, r.addedNodes, r.removedNodes]
	})
	targets.forEach(function(e) { console.log(e) })

	var record = records[0]
	var target = record.target
	if (record.type === 'characterData') {
		target = target.parentElement
	}
	var entity = editor.entity()
	var description = entity.description
	var selections = entity.selections()
	var $target = $(target)
	if ($target.is('span')) {
		var text = fromHTML( $target.html() )
		var start = 0, end, idx = -1
		var selection
		if ($target.is('.desex-selection')) {
			idx = $target.attr('id')
			selection = selections.find(function(s) { return s.id === idx })
			start = selection.start
			end = selection.end
			selection.end = start + text.length
		} else {
			var prev = $target.prev()
			if (prev.length) {
				idx = prev.attr('id')
				selection = selections.find(function(s) { return s.id === idx })
				start = selection.end
			}
			var next = selections[selections.indexOf(selection) + 1]
			if (next) {
				end = next.start
			}
		}

		entity.description = description.substring(0, start) + text + (end ? description.substring(end) : '')
			
		if (end) {
			var delta = text.length - end + start
			for (var i = +idx + 1, s = selections, l = s.length; i < l; i++) {
				s[i].start += delta
				s[i].end += delta
			}
		}
	}
})
$('#desex_test .desex-editor').each(function() {
	observer.observe(this, { childList : true, characterData : true, subtree : true })
})

